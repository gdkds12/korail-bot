import firebase_admin
from firebase_admin import credentials, firestore
from korail2 import Korail
import threading
import time
import requests
from datetime import datetime
from typing import Dict, Any
import os
import sys

# Force stdout flushing for Docker logs
sys.stdout.reconfigure(line_buffering=True)

# Initialize Firebase Admin SDK
if not firebase_admin._apps:
    app = firebase_admin.initialize_app()
else:
    app = firebase_admin.get_app()

db = firestore.client()

# Global state for managing threads
active_tasks: Dict[str, Any] = {}

def log(msg):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}")

def send_telegram_msg(token, chat_id, message):
    if not token or not chat_id:
        return
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {"chat_id": chat_id, "text": message}
        requests.post(url, json=payload, timeout=5)
    except Exception as e:
        log(f"Telegram error: {e}")

def get_user_credentials(uid):
    try:
        doc = db.collection('users').document(uid).get()
        if doc.exists:
            return doc.to_dict()
        return None
    except Exception as e:
        log(f"Error fetching credentials for {uid}: {e}")
        return None

def process_search_request(doc_snapshot, changes, read_time):
    for change in changes:
        if change.type.name == 'ADDED':
            doc = change.document
            data = doc.to_dict()
            
            if data.get('status') != 'PENDING':
                continue
                
            log(f"Processing search request: {doc.id}")
            
            try:
                user_data = get_user_credentials(data.get('uid'))
                if not user_data or not user_data.get('korailId') or not user_data.get('korailPw'):
                    doc.reference.update({'status': 'ERROR', 'error': '코레일 계정 설정이 필요합니다.'})
                    continue
                
                korail = Korail(user_data['korailId'], user_data['korailPw'])
                
                search_time = data.get('time', '000000')[:6].ljust(6, '0')
                trains = korail.search_train(
                    dep=data.get('dep'),
                    arr=data.get('arr'),
                    date=data.get('date'),
                    time=search_time,
                    include_no_seats=True
                )
                
                results = []
                for t in trains:
                    train_type = getattr(t, 'train_type_name', '열차')
                    train_no = getattr(t, 'train_no', '')
                    is_possible = getattr(t, 'reserve_possible', 'N') == 'Y'
                    seat_code = getattr(t, 'general_seat', '')
                    
                    results.append({
                        "train_name": f"{train_type} {train_no}".strip(),
                        "train_no": train_no,
                        "dep_name": getattr(t, 'dep_name', ''),
                        "dep_date": getattr(t, 'dep_date', ''),
                        "dep_time": f"{getattr(t, 'dep_date', '')}{getattr(t, 'dep_time', '')}",
                        "arr_name": getattr(t, 'arr_name', ''),
                        "arr_time": f"{getattr(t, 'arr_date', '')}{getattr(t, 'arr_time', '')}",
                        "general_seat": "예약가능" if is_possible and seat_code == '11' else ("입석+좌석" if seat_code == '15' else "매진"),
                        "reserve_possible": is_possible and seat_code == '11'
                    })
                
                doc.reference.update({
                    'status': 'COMPLETED',
                    'results': results,
                    'processedAt': datetime.now()
                })
                log(f"Search completed for {doc.id}")

            except Exception as e:
                log(f"Search error: {e}")
                doc.reference.update({'status': 'ERROR', 'error': str(e)})

def run_reservation_task(task_id, task_data, stop_event):
    log(f"Started worker for task {task_id}")
    
    uid = task_data.get('uid')
    user_data = get_user_credentials(uid)
    
    if not user_data:
        log(f"No credentials for task {task_id}")
        return

    korail_id = user_data.get('korailId')
    korail_pw = user_data.get('korailPw')
    tg_token = user_data.get('tgToken')
    tg_chat_id = user_data.get('tgChatId')

    try:
        korail = Korail(korail_id, korail_pw)
    except Exception as e:
        log(f"Login failed for task {task_id}: {e}")
        db.collection('tasks').document(task_id).update({'status': 'LOGIN_FAILED', 'is_running': False})
        return

    train_no = task_data.get('train_no')
    interval = float(task_data.get('interval', 3.0))
    dep_time_full = task_data.get('dep_time', '')
    search_time = dep_time_full[8:14] if len(dep_time_full) >= 14 else dep_time_full
    
    attempts = 0
    
    while not stop_event.is_set():
        attempts += 1
        
        # Update Firestore frequently for better UX (every try)
        try:
            db.collection('tasks').document(task_id).update({
                'attempts': attempts,
                'last_check': datetime.now().strftime("%H:%M:%S")
            })
        except Exception as e:
            # Ignore write errors to keep worker running
            pass

        try:
            trains = korail.search_train(
                dep=task_data.get('dep_name'),
                arr=task_data.get('arr_name'),
                date=task_data.get('dep_date'),
                time=search_time
            )
            target = next((t for t in trains if t.train_no == train_no), None)
            
            if target and getattr(target, 'general_seat', '') == '11' and getattr(target, 'reserve_possible', 'N') == 'Y':
                log(f"Attempting reservation for {task_id}")
                korail.reserve(target)
                
                db.collection('tasks').document(task_id).update({
                    'status': 'SUCCESS',
                    'is_running': False,
                    'attempts': attempts,
                    'completedAt': datetime.now()
                })
                
                msg = f"🎉 예약 성공!\n열차: {task_data.get('train_name')}\n구간: {task_data.get('dep_name')} -> {task_data.get('arr_name')}"
                send_telegram_msg(tg_token, tg_chat_id, msg)
                break
                
        except Exception as e:
            # log(f"Error in task {task_id}: {e}") # Reduce noise
            pass
        
        time.sleep(interval)
    
    log(f"Worker stopped for task {task_id}")

def on_tasks_snapshot(col_snapshot, changes, read_time):
    for change in changes:
        task_id = change.document.id
        data = change.document.to_dict()
        
        # Handle Added or Modified tasks
        if change.type.name == 'ADDED' or change.type.name == 'MODIFIED':
            is_running = data.get('is_running', False)
            status = data.get('status', '')

            # Start only if RUNNING and not already active
            if is_running and status == 'RUNNING':
                if task_id not in active_tasks:
                    stop_event = threading.Event()
                    t = threading.Thread(target=run_reservation_task, args=(task_id, data, stop_event))
                    t.daemon = True
                    t.start()
                    active_tasks[task_id] = {'stop_event': stop_event, 'thread': t}
                    log(f"Task started: {task_id}")
            
            # Stop if explicitly marked as NOT running (and currently active)
            # IMPORTANT: Don't stop if it's just an update of attempts count (is_running will still be True)
            elif not is_running:
                if task_id in active_tasks:
                    active_tasks[task_id]['stop_event'].set()
                    del active_tasks[task_id]
                    log(f"Task stopped by user/system: {task_id}")

        elif change.type.name == 'REMOVED':
            if task_id in active_tasks:
                active_tasks[task_id]['stop_event'].set()
                del active_tasks[task_id]
                log(f"Task removed: {task_id}")

def main():
    log("🚀 Korail Bot Backend Started")
    log(f"Project: {db.project}")
    log("Listening for changes in Firestore...")

    tasks_watch = db.collection('tasks').on_snapshot(on_tasks_snapshot)
    search_watch = db.collection('search_requests').on_snapshot(process_search_request)
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log("Shutting down...")
        for t in active_tasks.values():
            t['stop_event'].set()

if __name__ == "__main__":
    main()
