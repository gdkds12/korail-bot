from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from korail2 import Korail
from fastapi.middleware.cors import CORSMiddleware
import threading
import time as time_lib
from typing import Dict, Any
import requests
import os
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

app = FastAPI()

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LoginRequest(BaseModel):
    user_id: str
    password: str

class SearchRequest(BaseModel):
    dep: str
    arr: str
    date: str
    time: str

class ReserveRequest(BaseModel):
    train_no: str
    dep_date: str
    dep_time: str
    dep_name: str
    arr_name: str
    interval: float = 3.0
    train_name: str = ""

class TelegramSettings(BaseModel):
    token: str
    chat_id: str

korail_instance = None
tasks: Dict[str, Any] = {}

# 텔레그램 설정 초기화 (env에서 불러오기)
tg_settings = {
    "token": os.getenv("TELEGRAM_BOT_TOKEN", ""),
    "chat_id": os.getenv("TELEGRAM_CHAT_ID", "")
}

def send_telegram_msg(message: str):
    if not tg_settings["token"] or not tg_settings["chat_id"]:
        print("Telegram settings missing. Skipping notification.")
        return
    try:
        url = f"https://api.telegram.org/bot{tg_settings['token']}/sendMessage"
        payload = {"chat_id": tg_settings["chat_id"], "text": message}
        requests.post(url, json=payload, timeout=5)
    except Exception as e:
        print(f"Telegram error: {e}")

@app.post("/settings/telegram")
def update_telegram(req: TelegramSettings):
    tg_settings["token"] = req.token
    tg_settings["chat_id"] = req.chat_id
    send_telegram_msg("🔔 텔레그램 알림 설정이 업데이트되었습니다!")
    return {"status": "success", "message": "설정이 저장되었습니다."}

@app.post("/login")
def login(req: LoginRequest):
    global korail_instance
    try:
        # env에 계정이 있고 입력값이 없으면 env 값 사용 (편의성)
        u_id = req.user_id or os.getenv("KORAIL_ID")
        u_pw = req.password or os.getenv("KORAIL_PW")
        korail_instance = Korail(u_id, u_pw)
        return {"status": "success", "message": f"Successfully logged in as {u_id}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/search")
def search(req: SearchRequest):
    global korail_instance
    if not korail_instance:
        raise HTTPException(status_code=401, detail="먼저 로그인을 해주세요.")
    try:
        search_time = req.time[:6].ljust(6, '0')
        trains = korail_instance.search_train(
            dep=req.dep, arr=req.arr, date=req.date, time=search_time, include_no_seats=True
        )
        if not trains:
            return {"status": "success", "trains": [], "message": "조회 결과가 없습니다."}
        
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
        return {"status": "success", "trains": results}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

def reservation_worker(korail, req: ReserveRequest):
    train_no = req.train_no
    tasks[train_no]["is_running"] = True
    tasks[train_no]["attempts"] = 0
    tasks[train_no]["train_name"] = req.train_name
    
    search_time = req.dep_time[8:14] if len(req.dep_time) >= 14 else req.dep_time
    
    while tasks.get(train_no, {}).get("is_running", False):
        tasks[train_no]["attempts"] += 1
        tasks[train_no]["last_check"] = time_lib.strftime("%H:%M:%S")
        try:
            trains = korail.search_train(dep=req.dep_name, arr=req.arr_name, date=req.dep_date, time=search_time)
            target = next((t for t in trains if t.train_no == train_no), None)
            
            if target and getattr(target, 'general_seat', '') == '11' and getattr(target, 'reserve_possible', 'N') == 'Y':
                korail.reserve(target)
                tasks[train_no]["is_running"] = False
                tasks[train_no]["status"] = "SUCCESS"
                send_telegram_msg(f"🎉 예약 성공!\n열차: {req.train_name}\n구간: {req.dep_name} -> {req.arr_name}\n시도: {tasks[train_no]['attempts']}회")
                break
        except:
            pass
        time_lib.sleep(req.interval)

@app.post("/reserve_loop")
def reserve_loop(req: ReserveRequest):
    global korail_instance
    if not korail_instance: raise HTTPException(status_code=401, detail="먼저 로그인을 해주세요.")
    if req.train_no in tasks and tasks[req.train_no]["is_running"]: return {"message": "이미 실행 중입니다."}
    tasks[req.train_no] = {"is_running": True, "attempts": 0, "status": "RUNNING", "train_no": req.train_no}
    threading.Thread(target=reservation_worker, args=(korail_instance, req), daemon=True).start()
    return {"status": "success", "message": "자동 예약을 시작했습니다."}

@app.get("/tasks")
def get_tasks():
    return tasks

@app.post("/stop_task")
def stop_task(train_no: str):
    if train_no in tasks:
        tasks[train_no]["is_running"] = False
        tasks[train_no]["status"] = "STOPPED"
    return {"message": "정지되었습니다."}

@app.post("/clear_tasks")
def clear_tasks():
    global tasks
    tasks = {k: v for k, v in tasks.items() if v["is_running"]}
    return {"message": "종료된 태스크가 정리되었습니다."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)