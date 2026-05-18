import firebase_admin
from firebase_admin import credentials, firestore, messaging
from korail2 import Korail
from SRT import SRT
import threading
import time
import requests
from datetime import datetime
from typing import Dict, Any
import os
import sys

sys.stdout.reconfigure(line_buffering=True)

if not firebase_admin._apps:
    app = firebase_admin.initialize_app()
else:
    app = firebase_admin.get_app()

db = firestore.client()

active_tasks: Dict[str, Any] = {}


def configure_korail_proxy():
    proxy_url = os.getenv('KORAIL_PROXY', '').strip()
    if not proxy_url:
        log('Proxy: disabled')
        return
    os.environ['HTTP_PROXY'] = proxy_url
    os.environ['HTTPS_PROXY'] = proxy_url
    log(f'Proxy: enabled ({proxy_url})')

def log(msg):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}")

def send_fcm_notification(token, title, body):
    if not token:
        return
    proxy_vars = {k: os.environ.pop(k, None) for k in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy')}
    try:
        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            android=messaging.AndroidConfig(
                priority='high',
                notification=messaging.AndroidNotification(
                    priority='high',
                    default_vibrate_timings=True,
                ),
            ),
            apns=messaging.APNSConfig(
                headers={'apns-priority': '10'},
            ),
            token=token,
        )
        response = messaging.send(message)
        log(f"FCM notification sent: {response}")
    except Exception as e:
        log(f"FCM error: {e}")
    finally:
        for k, v in proxy_vars.items():
            if v is not None:
                os.environ[k] = v

def send_telegram_msg(token, chat_id, message):
    if not token or not chat_id:
        return
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        requests.post(url, json={"chat_id": chat_id, "text": message}, timeout=5)
    except Exception as e:
        log(f"Telegram error: {e}")

def get_user_credentials(uid):
    try:
        doc = db.collection('users').document(uid).get()
        return doc.to_dict() if doc.exists else None
    except Exception as e:
        log(f"Error fetching credentials for {uid}: {e}")
        return None

def classify_error(err_text: str):
    text = (err_text or "").strip()
    lower = text.lower()
    if "macro error" in lower:
        return {"error_code": "MACRO_BLOCK", "user_message": "서버에서 자동화 요청을 차단했습니다(MACRO ERROR)."}
    if "err299929" in lower:
        return {"error_code": "SPECIAL_PERIOD", "user_message": "명절 특별수송 기간으로 조회가 제한되었습니다."}
    if "로그인" in text and "필요" in text:
        return {"error_code": "LOGIN_REQUIRED", "user_message": "계정 로그인 상태를 확인해 주세요."}
    return {"error_code": "UNKNOWN", "user_message": text or "조회 중 알 수 없는 오류가 발생했습니다."}


def process_search_request(doc_snapshot, changes, read_time):
    for change in changes:
        if change.type.name != 'ADDED':
            continue
        doc = change.document
        data = doc.to_dict()

        if data.get('status') != 'PENDING':
            continue

        log(f"Processing search request: {doc.id}")
        train_type = data.get('trainType', 'KTX').upper()

        try:
            user_data = get_user_credentials(data.get('uid'))
            search_time = data.get('time', '000000')[:6].ljust(6, '0')

            if train_type == 'SRT':
                if not user_data or not user_data.get('srtId') or not user_data.get('srtPw'):
                    doc.reference.update({'status': 'ERROR', 'error': 'SRT 계정 설정이 필요합니다.'})
                    continue
                srt = SRT(user_data['srtId'], user_data['srtPw'])
                trains = srt.search_train(
                    dep=data.get('dep'),
                    arr=data.get('arr'),
                    date=data.get('date'),
                    time=search_time,
                    available_only=False
                )
                results = []
                for t in trains:
                    results.append({
                        "train_name": f"{t.train_name} {t.train_number}".strip(),
                        "train_no": t.train_number,
                        "dep_name": t.dep_station_name,
                        "dep_date": t.dep_date,
                        "dep_time": f"{t.dep_date}{t.dep_time}",
                        "arr_name": t.arr_station_name,
                        "arr_time": f"{t.arr_date}{t.arr_time}",
                        "general_seat": "예약가능" if t.general_seat_available() else ("대기가능" if t.reserve_standby_available() else "매진"),
                        "reserve_possible": t.general_seat_available()
                    })
            else:
                if not user_data or not user_data.get('korailId') or not user_data.get('korailPw'):
                    doc.reference.update({'status': 'ERROR', 'error': '코레일 계정 설정이 필요합니다.'})
                    continue
                korail = Korail(user_data['korailId'], user_data['korailPw'])
                trains = korail.search_train(
                    dep=data.get('dep'),
                    arr=data.get('arr'),
                    date=data.get('date'),
                    time=search_time,
                    include_no_seats=True
                )
                results = []
                for t in trains:
                    train_type_name = getattr(t, 'train_type_name', '열차')
                    train_no = getattr(t, 'train_no', '')
                    is_possible = getattr(t, 'reserve_possible', 'N') == 'Y'
                    seat_code = getattr(t, 'general_seat', '')
                    results.append({
                        "train_name": f"{train_type_name} {train_no}".strip(),
                        "train_no": train_no,
                        "dep_name": getattr(t, 'dep_name', ''),
                        "dep_date": getattr(t, 'dep_date', ''),
                        "dep_time": f"{getattr(t, 'dep_date', '')}{getattr(t, 'dep_time', '')}",
                        "arr_name": getattr(t, 'arr_name', ''),
                        "arr_time": f"{getattr(t, 'arr_date', '')}{getattr(t, 'arr_time', '')}",
                        "general_seat": "예약가능" if is_possible and seat_code == '11' else ("입석+좌석" if seat_code == '15' else "매진"),
                        "reserve_possible": is_possible and seat_code == '11'
                    })

            doc.reference.update({'status': 'COMPLETED', 'results': results, 'processedAt': datetime.now()})
            log(f"Search completed for {doc.id}")

        except Exception as e:
            err_text = str(e)
            classified = classify_error(err_text)
            log(f"Search error [{classified['error_code']}]: {err_text}")
            doc.reference.update({
                'status': 'ERROR',
                'error': err_text,
                'error_code': classified['error_code'],
                'user_message': classified['user_message'],
            })


def run_reservation_task(task_id, task_data, stop_event):
    log(f"Started worker for task {task_id}")

    uid = task_data.get('uid')
    user_data = get_user_credentials(uid)
    if not user_data:
        log(f"No credentials for task {task_id}")
        return

    train_type = task_data.get('trainType', 'KTX').upper()
    tg_token = user_data.get('tgToken')
    tg_chat_id = user_data.get('tgChatId')
    interval = float(task_data.get('interval', 3.0))
    train_no = task_data.get('train_no')
    dep_time_full = task_data.get('dep_time', '')
    search_time = dep_time_full[8:14] if len(dep_time_full) >= 14 else dep_time_full

    try:
        if train_type == 'SRT':
            client = SRT(user_data.get('srtId'), user_data.get('srtPw'))
        else:
            client = Korail(user_data.get('korailId'), user_data.get('korailPw'))
    except Exception as e:
        log(f"Login failed for task {task_id}: {e}")
        db.collection('tasks').document(task_id).update({'status': 'LOGIN_FAILED', 'is_running': False})
        return

    attempts = 0
    while not stop_event.is_set():
        attempts += 1
        try:
            db.collection('tasks').document(task_id).update({
                'attempts': attempts,
                'last_check': datetime.now().strftime("%H:%M:%S")
            })
        except: pass

        try:
            if train_type == 'SRT':
                trains = client.search_train(
                    dep=task_data.get('dep_name'),
                    arr=task_data.get('arr_name'),
                    date=task_data.get('dep_date'),
                    time=search_time,
                    available_only=False
                )
                target = next((t for t in trains if t.train_number == train_no and t.general_seat_available()), None)
            else:
                trains = client.search_train(
                    dep=task_data.get('dep_name'),
                    arr=task_data.get('arr_name'),
                    date=task_data.get('dep_date'),
                    time=search_time
                )
                target = next((t for t in trains if t.train_no == train_no
                               and getattr(t, 'general_seat', '') == '11'
                               and getattr(t, 'reserve_possible', 'N') == 'Y'), None)

            if target:
                log(f"Attempting reservation for {task_id}")
                client.reserve(target)
                db.collection('tasks').document(task_id).update({
                    'status': 'SUCCESS', 'is_running': False,
                    'attempts': attempts, 'completedAt': datetime.now()
                })
                rail = "SRT" if train_type == 'SRT' else "코레일"
                msg = f"예약 성공!\n열차: {task_data.get('train_name')}\n구간: {task_data.get('dep_name')} -> {task_data.get('arr_name')}"
                send_telegram_msg(tg_token, tg_chat_id, msg)
                fcm_token = user_data.get('fcmToken')
                if fcm_token:
                    send_fcm_notification(fcm_token, f"{rail} 예약 성공!", msg)
                break

        except Exception as e:
            pass

        time.sleep(interval)

    log(f"Worker stopped for task {task_id}")


def handle_test_notification(task_id, task_data):
    log(f"Received test notification request: {task_id}")
    time.sleep(10)
    uid = task_data.get('uid')
    user_data = get_user_credentials(uid)
    if user_data:
        msg = "코레일/SRT 봇 알림 테스트 성공!"
        send_fcm_notification(user_data.get('fcmToken'), "알림 테스트", msg)
        send_telegram_msg(user_data.get('tgToken'), user_data.get('tgChatId'), msg)
    db.collection('tasks').document(task_id).update({'status': 'TEST_COMPLETED', 'is_running': False})
    log(f"Test notification completed: {task_id}")


def on_tasks_snapshot(col_snapshot, changes, read_time):
    for change in changes:
        task_id = change.document.id
        data = change.document.to_dict()

        if change.type.name in ('ADDED', 'MODIFIED'):
            is_running = data.get('is_running', False)
            status = data.get('status', '')
            task_type = data.get('type', 'RESERVATION')

            if task_type == 'TEST_NOTIFICATION' and status == 'PENDING':
                db.collection('tasks').document(task_id).update({'status': 'RUNNING'})
                threading.Thread(target=handle_test_notification, args=(task_id, data), daemon=True).start()
                continue

            if task_type == 'FETCH_TICKETS' and status == 'PENDING':
                db.collection('tasks').document(task_id).update({'status': 'RUNNING'})
                threading.Thread(target=handle_fetch_tickets, args=(task_id, data), daemon=True).start()
                continue

            if is_running and status == 'RUNNING' and task_type not in ('TEST_NOTIFICATION', 'FETCH_TICKETS'):
                if task_id not in active_tasks:
                    stop_event = threading.Event()
                    t = threading.Thread(target=run_reservation_task, args=(task_id, data, stop_event))
                    t.daemon = True
                    t.start()
                    active_tasks[task_id] = {'stop_event': stop_event, 'thread': t}
                    log(f"Task started: {task_id}")

            elif not is_running:
                if task_id in active_tasks:
                    active_tasks[task_id]['stop_event'].set()
                    del active_tasks[task_id]
                    log(f"Task stopped: {task_id}")

        elif change.type.name == 'REMOVED':
            if task_id in active_tasks:
                active_tasks[task_id]['stop_event'].set()
                del active_tasks[task_id]
                log(f"Task removed: {task_id}")


def handle_fetch_tickets(task_id, task_data):
    log(f"Fetching tickets for task: {task_id}")
    uid = task_data.get('uid')
    user_data = get_user_credentials(uid)
    if not user_data:
        db.collection('tasks').document(task_id).update({'status': 'ERROR', 'error': '사용자 정보 없음', 'is_running': False})
        return

    ktx_tickets, srt_tickets, errors = [], [], []

    # 승차권 조회는 IP 차단 위험이 없으므로 프록시 없이 직접 연결
    proxy_vars = {k: os.environ.pop(k, None) for k in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy')}
    try:
        _do_fetch_tickets(task_id, user_data, ktx_tickets, srt_tickets, errors)
    finally:
        for k, v in proxy_vars.items():
            if v is not None:
                os.environ[k] = v

def _do_fetch_tickets(task_id, user_data, ktx_tickets, srt_tickets, errors):
    log(f"Ticket fetch - korailId set: {bool(user_data.get('korailId'))}, srtId set: {bool(user_data.get('srtId'))}")
    if user_data.get('korailId') and user_data.get('korailPw'):
        try:
            log(f"KTX login attempt: {user_data['korailId'][:4]}***")
            korail = Korail(user_data['korailId'], user_data['korailPw'])

            def _ktx_item(r, paid):
                dep_t = getattr(r, 'dep_time', '') or ''
                arr_t = getattr(r, 'arr_time', '') or ''
                car_no = getattr(r, 'car_no', '') or ''
                seat_no = getattr(r, 'seat_no', '') or ''
                seat_info = f"{car_no}호차 {seat_no}".strip() if car_no or seat_no else ''
                buy_dt = getattr(r, 'buy_limit_date', '') if not paid else ''
                buy_tm = getattr(r, 'buy_limit_time', '') if not paid else ''
                return {
                    'type': 'KTX',
                    'rsv_id': getattr(r, 'rsv_id', '') or getattr(r, 'sale_info1', ''),
                    'train_name': f"{getattr(r, 'train_type_name', 'KTX')} {getattr(r, 'train_no', '')}".strip(),
                    'dep_name': getattr(r, 'dep_name', ''),
                    'arr_name': getattr(r, 'arr_name', ''),
                    'dep_date': getattr(r, 'dep_date', ''),
                    'dep_time': dep_t,
                    'arr_time': arr_t,
                    'price': getattr(r, 'price', 0),
                    'seat_count': getattr(r, 'seat_no_count', 1),
                    'seat_info': seat_info,
                    'buy_limit': f"{buy_dt} {buy_tm}".strip() if buy_dt else '',
                    'paid': paid,
                }

            # 결제 완료 승차권
            issued = korail.tickets()
            log(f"KTX tickets (issued) count: {len(issued)}")
            for t in issued:
                ktx_tickets.append(_ktx_item(t, paid=True))

            # 미결제 예약
            pending = korail.reservations()
            log(f"KTX reservations (pending) count: {len(pending)}")
            for r in pending:
                ktx_tickets.append(_ktx_item(r, paid=False))

        except Exception as e:
            errors.append(f"KTX: {str(e)[:80]}")
            log(f"KTX ticket error: {e}")

    if user_data.get('srtId') and user_data.get('srtPw'):
        try:
            srt = SRT(user_data['srtId'], user_data['srtPw'])
            for r in srt.get_reservations():
                seat_info = ''
                try:
                    if r._tickets:
                        seat_info = ', '.join(f"{t.car}호차 {t.seat}" for t in r._tickets)
                except: pass
                srt_tickets.append({
                    'type': 'SRT',
                    'rsv_id': str(r.reservation_number),
                    'train_name': f"{r.train_name} {r.train_number}".strip(),
                    'dep_name': r.dep_station_name,
                    'arr_name': r.arr_station_name,
                    'dep_date': r.dep_date,
                    'dep_time': r.dep_time,
                    'arr_time': r.arr_time,
                    'price': int(r.total_cost or 0),
                    'seat_count': int(r.seat_count or 1),
                    'seat_info': seat_info,
                    'paid': r.paid,
                    'buy_limit': f"{r.payment_date} {r.payment_time}".strip() if not r.paid else '',
                })
        except Exception as e:
            errors.append(f"SRT: {str(e)[:80]}")
            log(f"SRT ticket error: {e}")

    db.collection('tasks').document(task_id).update({
        'status': 'COMPLETED', 'is_running': False,
        'ktx': ktx_tickets, 'srt': srt_tickets, 'errors': errors,
        'processedAt': datetime.now(),
    })
    log(f"Tickets fetched: KTX={len(ktx_tickets)}, SRT={len(srt_tickets)}")



def main():
    log("🚀 Korail/SRT Bot Backend Started")
    log(f"Project: {db.project}")
    configure_korail_proxy()
    log("Listening for changes in Firestore...")
    db.collection('tasks').on_snapshot(on_tasks_snapshot)
    db.collection('search_requests').on_snapshot(process_search_request)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log("Shutting down...")
        for t in active_tasks.values():
            t['stop_event'].set()


if __name__ == "__main__":
    main()
