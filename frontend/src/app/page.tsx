'use client';

import { useState, useEffect } from 'react';

const MAJOR_STATIONS = [
  '서울', '용산', '광명', '천안아산', '오송', '대전', '김천구미', '동대구', '신경주', '울산', '부산',
  '수원', '평택', '천안', '조치원', '대구', '구포', '영등포', '안양', '익산', '전주', '광주송정', '목포', '순천', '여수EXPO', '포항', '마산', '창원중앙', '강릉'
].sort();

export default function Home() {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('search'); // 'search' | 'manage' | 'settings'
  
  // Telegram settings state
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');

  const [dep, setDep] = useState('서울');
  const [arr, setArr] = useState('부산');
  const [displayDate, setDisplayDate] = useState(''); // 이 줄이 누락되었습니다.
  const [time, setTime] = useState('06');
  const [interval, setInterval] = useState(3.0);
  const [trains, setTrains] = useState<any[]>([]);
  
  // Dashboard state
  const [tasks, setTasks] = useState<any>({});


  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    setDisplayDate(today);
    
    const fetchTasks = async () => {
      try {
        const res = await fetch(`${getBackendUrl()}/tasks`);
        const data = await res.json();
        setTasks(data);
      } catch (e) {}
    };

    const fetchSettings = async () => {
      try {
        const res = await fetch(`${getBackendUrl()}/health`); // 임시로 health 사용하거나 새로 만들 수 있음
        // 하지만 여기서는 그냥 초기 상태에서 봇 정보를 보여주기 위해 
        // 하드코딩된 값 대신 백엔드에서 가져오도록 설계를 나중에 보강할 수 있습니다.
      } catch (e) {}
    };

    const timer = window.setInterval(fetchTasks, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const getBackendUrl = () => {
    return `${window.location.protocol}//${window.location.hostname}:8001`;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch(`${getBackendUrl()}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, password }),
      });
      if (response.ok) {
        setIsLoggedIn(true);
        setMessage('✅ 로그인 성공');
      } else {
        const data = await response.json();
        setMessage(`❌ 오류: ${data.detail}`);
      }
    } catch (e) { setMessage('⚠️ 연결 실패'); }
    setLoading(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch(`${getBackendUrl()}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dep, arr, date: displayDate.replace(/-/g, ''), time: time.padStart(2, '0') + '0000' }),
      });
      const data = await response.json();
      setTrains(data.trains || []);
      setMessage(data.message || `📅 ${data.trains?.length || 0}개 열차 조회됨`);
    } catch (e) { setMessage('⚠️ 연결 실패'); }
    setLoading(false);
  };

  const handleReserveLoop = async (train: any) => {
    try {
      const response = await fetch(`${getBackendUrl()}/reserve_loop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          train_no: train.train_no,
          dep_date: train.dep_date,
          dep_time: train.dep_time,
          dep_name: train.dep_name,
          arr_name: train.arr_name,
          interval: interval,
          train_name: train.train_name
        }),
      });
      if (response.ok) alert('🚀 매크로가 시작되었습니다. 관리 탭에서 확인하세요!');
    } catch (e) { alert('⚠️ 시작 실패'); }
  };

  const handleStopTask = async (trainNo: string) => {
    await fetch(`${getBackendUrl()}/stop_task?train_no=${trainNo}`, { method: 'POST' });
  };

  const handleClearTasks = async () => {
    await fetch(`${getBackendUrl()}/clear_tasks`, { method: 'POST' });
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(`${getBackendUrl()}/settings/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tgToken, chat_id: tgChatId }),
      });
      if (response.ok) alert('✅ 설정이 저장되었습니다. 텔레그램 메시지를 확인하세요!');
    } catch (e) { alert('⚠️ 저장 실패'); }
  };

  if (!isLoggedIn) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white shadow-2xl rounded-3xl p-8 w-full max-w-md border border-gray-100">
          <h1 className="text-3xl font-black text-blue-900 text-center mb-8">Korail Bot</h1>
          <form onSubmit={handleLogin} className="space-y-5">
            <input type="text" value={userId} onChange={e => setUserId(e.target.value)} className="w-full p-4 border rounded-2xl text-black outline-none focus:ring-2 focus:ring-blue-500 transition-all" placeholder="회원번호" />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-4 border rounded-2xl text-black outline-none focus:ring-2 focus:ring-blue-500 transition-all" placeholder="비밀번호" />
            <button type="submit" disabled={loading} className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg disabled:bg-gray-300">
              {loading ? '로그인 중...' : '시작하기'}
            </button>
          </form>
          {message && <p className="mt-4 text-center text-sm font-medium text-red-500">{message}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 pb-20">
      <nav className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto flex">
          <button onClick={() => setActiveTab('search')} className={`flex-1 py-4 font-bold text-sm transition-all ${activeTab === 'search' ? 'text-blue-600 border-b-4 border-blue-600' : 'text-gray-400'}`}>
            🔍 열차 조회
          </button>
          <button onClick={() => setActiveTab('manage')} className={`flex-1 py-4 font-bold text-sm transition-all ${activeTab === 'manage' ? 'text-blue-600 border-b-4 border-blue-600' : 'text-gray-400'}`}>
            ⚡ 매크로 관리 ({Object.values(tasks).filter((t: any) => t.is_running).length})
          </button>
          <button onClick={() => setActiveTab('settings')} className={`flex-1 py-4 font-bold text-sm transition-all ${activeTab === 'settings' ? 'text-blue-600 border-b-4 border-blue-600' : 'text-gray-400'}`}>
            ⚙️ 설정
          </button>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto p-4 mt-6">
        {activeTab === 'search' ? (
          /* ... Search Content ... */
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <form onSubmit={handleSearch} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="flex flex-col"><label className="text-[10px] font-bold text-gray-400 mb-1 ml-1">출발</label>
                  <select value={dep} onChange={e => setDep(e.target.value)} className="p-2 border rounded-xl text-black bg-gray-50 text-sm outline-none focus:ring-2 focus:ring-blue-500">
                    {MAJOR_STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex flex-col"><label className="text-[10px] font-bold text-gray-400 mb-1 ml-1">도착</label>
                  <select value={arr} onChange={e => setArr(e.target.value)} className="p-2 border rounded-xl text-black bg-gray-50 text-sm outline-none focus:ring-2 focus:ring-blue-500">
                    {MAJOR_STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex flex-col"><label className="text-[10px] font-bold text-gray-400 mb-1 ml-1">날짜</label>
                  <input type="date" value={displayDate} onChange={e => setDisplayDate(e.target.value)} className="p-2 border rounded-xl text-black bg-gray-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex flex-col"><label className="text-[10px] font-bold text-gray-400 mb-1 ml-1">시간</label>
                  <select value={time} onChange={e => setTime(e.target.value)} className="p-2 border rounded-xl text-black bg-gray-50 text-sm outline-none focus:ring-2 focus:ring-blue-500">
                    {Array.from({length: 24}, (_, i) => i).map(h => <option key={h} value={h.toString().padStart(2, '0')}>{h}시</option>)}
                  </select>
                </div>
                <div className="flex flex-col"><label className="text-[10px] font-bold text-gray-400 mb-1 ml-1">간격(초)</label>
                  <input type="number" step="0.1" min="0.5" value={interval} onChange={e => setInterval(parseFloat(e.target.value))} className="p-2 border rounded-xl text-black bg-gray-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex items-end">
                  <button type="submit" className="w-full py-2 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-md text-sm h-[38px]">조회</button>
                </div>
              </form>
            </div>

            <div className="grid gap-3">
              {trains.map((train, i) => (
                <div key={i} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-blue-600">{train.train_name}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-lg font-black text-gray-800">{train.dep_time.substring(8, 10)}:{train.dep_time.substring(10, 12)}</span>
                      <span className="text-gray-300">→</span>
                      <span className="text-lg font-bold text-gray-500">{train.arr_time.substring(8, 10)}:{train.arr_time.substring(10, 12)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${train.reserve_possible ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-500'}`}>
                      {train.general_seat}
                    </span>
                    <button 
                      onClick={() => handleReserveLoop(train)}
                      disabled={Object.values(tasks).some((t: any) => t.is_running && t.train_no === train.train_no)}
                      className="px-5 py-2 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 shadow-sm text-sm disabled:bg-gray-200"
                    >
                      {Object.values(tasks).some((t: any) => t.is_running && t.train_no === train.train_no) ? '감시 중' : '대기하기'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : activeTab === 'manage' ? (
          /* ... Manage Content ... */
          <div className="space-y-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-black text-gray-800">실시간 매크로 현황</h2>
              <button onClick={handleClearTasks} className="text-xs text-gray-400 hover:text-red-500 font-bold underline">기록 삭제</button>
            </div>
            {Object.entries(tasks).length === 0 ? (
              <div className="text-center py-20 text-gray-300 font-bold">실행 중인 매크로가 없습니다.</div>
            ) : (
              <div className="grid gap-4">
                {Object.entries(tasks).map(([no, task]: [string, any]) => (
                  <div key={no} className={`p-6 rounded-3xl shadow-sm border-2 transition-all ${task.is_running ? 'bg-white border-blue-100' : 'bg-gray-50 border-transparent opacity-70'}`}>
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md mb-2 inline-block ${task.status === 'SUCCESS' ? 'bg-green-500 text-white' : (task.is_running ? 'bg-blue-600 text-white animate-pulse' : 'bg-gray-400 text-white')}`}>
                          {task.status}
                        </span>
                        <h3 className="text-xl font-black text-gray-800">{task.train_name || `열차 ${no}`}</h3>
                      </div>
                      <div className="text-right">
                        <span className="text-3xl font-black text-blue-600">{task.attempts.toLocaleString()}</span>
                        <span className="text-[10px] font-bold text-gray-400 block">조회 시도 횟수</span>
                      </div>
                    </div>
                    <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                      <span className="text-xs text-gray-400 font-bold">마지막 확인: {task.last_check || '-'}</span>
                      {task.is_running && (
                        <button onClick={() => handleStopTask(no)} className="px-4 py-2 bg-red-50 text-red-600 font-bold rounded-xl hover:bg-red-600 hover:text-white transition-all text-xs">
                          감시 중지
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Settings Tab Content */
          <div className="space-y-6">
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
              <h2 className="text-2xl font-black text-gray-800 mb-6">🔔 알림 설정</h2>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">
                텔레그램 봇을 생성하여 토큰과 채팅 ID를 입력하면, 예약 성공 시 즉시 푸시 알림을 보내드립니다.
              </p>
              <form onSubmit={handleSaveSettings} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 ml-1">Telegram Bot Token</label>
                  <input 
                    type="text" 
                    value={tgToken} 
                    onChange={e => setTgToken(e.target.value)} 
                    className="w-full p-4 border rounded-2xl text-black outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" 
                    placeholder="123456789:ABCDefgh..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 ml-1">Chat ID</label>
                  <input 
                    type="text" 
                    value={tgChatId} 
                    onChange={e => setTgChatId(e.target.value)} 
                    className="w-full p-4 border rounded-2xl text-black outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" 
                    placeholder="123456789"
                  />
                </div>
                <button type="submit" className="w-full py-4 bg-gray-900 text-white font-bold rounded-2xl hover:bg-black transition-all shadow-lg">
                  설정 저장 및 테스트 메시지 전송
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
      {message && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full text-xs font-bold shadow-2xl z-[60]">{message}</div>}
    </main>
  );
}