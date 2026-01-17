'use client';

import { useState, useEffect } from 'react';
import { auth, db, googleProvider, requestFcmToken } from '../lib/firebase';
import { signInWithPopup, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, setDoc, getDoc } from 'firebase/firestore';

const VAPID_KEY = "BPNkW11fORIDrPxfHtKT8QM65DSp6jfW2gHrKBy-Dmtxbzd52vq4Lrf1FZaPCEwPNC8fbfGCSFjGYn5ReHhI_fQ";

const MAJOR_STATIONS = [
  '서울', '용산', '광명', '천안아산', '오송', '대전', '김천구미', '동대구', '신경주', '울산', '부산',
  '수원', '평택', '천안', '조치원', '대구', '구포', '영등포', '안양', '익산', '전주', '광주송정', '목포', '순천', '여수EXPO', '포항', '마산', '창원중앙', '강릉'
].sort();

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  
  // Korail Credentials (stored in Firestore)
  const [korailId, setKorailId] = useState('');
  const [korailPw, setKorailPw] = useState('');
  
  const [message, setMessage] = useState('');
  
  // Auto-hide message after 3 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('search');
  
  // Telegram settings
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  // FCM
  const [fcmToken, setFcmToken] = useState('');

  // Search params
  const [dep, setDep] = useState('서울');
  const [arr, setArr] = useState('부산');
  const [displayDate, setDisplayDate] = useState('');
  const [time, setTime] = useState('06');
  const [interval, setInterval] = useState(3.0);
  const [trains, setTrains] = useState<any[]>([]);
  
  // Tasks from Firestore
  const [tasks, setTasks] = useState<any>({});

  // Auth & Initial Data Loading
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    setDisplayDate(today);

    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Load User Settings (Korail ID, Telegram)
        const userRef = doc(db, 'users', u.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          setKorailId(data.korailId || '');
          setKorailPw(data.korailPw || '');
          setTgToken(data.tgToken || '');
          setTgChatId(data.tgChatId || '');
          setFcmToken(data.fcmToken || '');
        }

        // Realtime Tasks Listener
        const q = query(collection(db, 'tasks'), where('uid', '==', u.uid));
        const unsubscribeTasks = onSnapshot(q, (snapshot) => {
          const newTasks: any = {};
          snapshot.forEach((doc) => {
            newTasks[doc.id] = { id: doc.id, ...doc.data() };
          });
          setTasks(newTasks);
        });
        return () => unsubscribeTasks();
      } else {
        setTasks({});
      }
    });

    return () => unsubscribeAuth();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setMessage('✅ 로그인 성공');
    } catch (e: any) {
      console.error(e);
      // Show detailed error code for debugging
      setMessage(`❌ 로그인 실패: ${e.code || e.message}`);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setMessage('👋 로그아웃');
  };

  const saveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), {
        korailId,
        korailPw,
        tgToken,
        tgChatId,
        fcmToken // Include FCM token
      }, { merge: true });
      setMessage('✅ 설정이 저장되었습니다.');
    } catch (e) {
      setMessage('⚠️ 저장 실패');
    }
  };

  const handleEnablePush = async () => {
    const token = await requestFcmToken(VAPID_KEY);
    if (token) {
      setFcmToken(token);
      setMessage('🔔 푸시 알림이 활성화되었습니다! 설정을 저장해주세요.');
    } else {
      setMessage('❌ 푸시 권한을 허용해야 합니다.');
    }
  };

  const handleTestPush = async () => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'tasks'), {
        uid: user.uid,
        type: 'TEST_NOTIFICATION', // Special type
        is_running: true,
        status: 'PENDING',
        createdAt: new Date(),
        train_name: '테스트 열차'
      });
      setMessage('⏳ 10초 뒤에 알림이 발송됩니다...');
    } catch (e) {
      setMessage('❌ 요청 실패');
    }
  };

  // Note: Search still needs a backend API because we can't run Korail Python lib in browser.
  // For now, we will simulate or assume the backend provides a Search API via a different mechanism
  // OR we can implement a "Search Request" via Firestore? 
  // --> Let's keep using fetch() for SEARCH but point to the Python backend which is now just a worker?
  // No, the Python backend on Linux server can expose a simple HTTP endpoint just for Search.
  // We will assume the backend is still running a lightweight HTTP server for Search ONLY.
  // Let's keep the fetch logic but user needs to know the IP. 
  // *Critique*: If we move to App Hosting, we can't easily hit a random IP.
  // *Better Idea*: Use a "search_requests" collection in Firestore.
  // 1. User adds doc to 'search_requests'.
  // 2. Backend watches it, performs search, writes results back to doc.
  // 3. Frontend watches doc for results.
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setTrains([]);
    setMessage('⏳ 조회 요청 중...');

    try {
      // Create a temporary search request
      const reqRef = await addDoc(collection(db, 'search_requests'), {
        uid: user.uid,
        dep,
        arr,
        date: displayDate.replace(/-/g, ''),
        time: time.padStart(2, '0') + '0000',
        createdAt: new Date(),
        status: 'PENDING'
      });

      // Wait for result (One-time listener)
      const unsubscribe = onSnapshot(doc(db, 'search_requests', reqRef.id), (docSnap) => {
        const data = docSnap.data();
        if (data && data.status === 'COMPLETED') {
          setTrains(data.results || []);
          setMessage(`📅 ${data.results?.length || 0}개 열차 조회됨`);
          setLoading(false);
          unsubscribe(); // Stop listening
        } else if (data && data.status === 'ERROR') {
          setMessage(`❌ 오류: ${data.error}`);
          setLoading(false);
          unsubscribe();
        }
      });

      // Timeout safety - Just show a warning, DO NOT unsubscribe
      setTimeout(() => {
        setLoading((currentLoading) => {
          if (currentLoading) {
            setMessage('⚠️ 응답이 지연되고 있습니다... (계속 대기 중)');
          }
          return currentLoading;
        });
        // We do NOT call unsubscribe() here anymore.
        // The listener will stay active until component unmounts or success.
      }, 15000); // Warn after 15s

    } catch (e) {
      setMessage('⚠️ 요청 실패');
      setLoading(false);
    }
  };

  const handleReserveLoop = async (train: any) => {
    if (!user) return;
    if (!korailId || !korailPw) {
      alert('⚠️ 먼저 설정 탭에서 코레일 계정을 저장해주세요.');
      setActiveTab('settings');
      return;
    }
    
    try {
      await addDoc(collection(db, 'tasks'), {
        uid: user.uid,
        train_no: train.train_no,
        train_name: train.train_name,
        dep_date: train.dep_date,
        dep_time: train.dep_time,
        dep_name: train.dep_name,
        arr_name: train.arr_name,
        interval: interval,
        is_running: true,
        status: 'RUNNING',
        attempts: 0,
        createdAt: new Date(),
        last_check: '-'
      });
      alert('🚀 예약 작업이 추가되었습니다. 관리 탭에서 확인하세요!');
    } catch (e) {
      alert('⚠️ 작업 추가 실패');
    }
  };

  const handleStopTask = async (taskId: string) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        is_running: false,
        status: 'STOPPED'
      });
    } catch (e) {}
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try {
      // In Firebase SDK v9+, deleteDoc needs a doc reference
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'tasks', taskId));
      setMessage('🗑️ 작업이 삭제되었습니다.');
    } catch (e) {
      setMessage('⚠️ 삭제 실패');
    }
  };

  if (!user) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white shadow-2xl rounded-3xl p-8 w-full max-w-md border border-gray-100 text-center">
          <h1 className="text-3xl font-black text-blue-900 mb-8">Korail Bot</h1>
          <p className="text-gray-500 mb-8">구글 계정으로 로그인하여 시작하세요.</p>
          <button onClick={handleLogin} className="w-full py-4 bg-white border-2 border-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all flex items-center justify-center gap-3">
             <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-6 h-6" alt="Google" />
             Google로 계속하기
          </button>
          {message && <p className="mt-4 text-sm font-medium text-red-500">{message}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 pb-20">
      <nav className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto flex">
          <button onClick={() => setActiveTab('search')} className={`flex-1 py-4 font-bold text-sm transition-all ${activeTab === 'search' ? 'text-blue-600 border-b-4 border-blue-600' : 'text-gray-400'}`}>
            🔍 조회
          </button>
          <button onClick={() => setActiveTab('manage')} className={`flex-1 py-4 font-bold text-sm transition-all ${activeTab === 'manage' ? 'text-blue-600 border-b-4 border-blue-600' : 'text-gray-400'}`}>
            ⚡ 관리 ({Object.values(tasks).filter((t: any) => t.is_running).length})
          </button>
          <button onClick={() => setActiveTab('settings')} className={`flex-1 py-4 font-bold text-sm transition-all ${activeTab === 'settings' ? 'text-blue-600 border-b-4 border-blue-600' : 'text-gray-400'}`}>
            ⚙️ 설정
          </button>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto p-4 mt-6">
        {activeTab === 'search' ? (
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
                  <button type="submit" disabled={loading} className="w-full py-2 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-md text-sm h-[38px] disabled:bg-gray-300">
                    {loading ? '...' : '조회'}
                  </button>
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
                      // Check if tasks object contains a task with matching train_no and is_running
                      disabled={Object.values(tasks).some((t: any) => t.is_running && t.train_no === train.train_no)}
                      className="px-5 py-2 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 shadow-sm text-sm disabled:bg-gray-200"
                    >
                      대기하기
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : activeTab === 'manage' ? (
          <div className="space-y-6">
            <h2 className="text-xl font-black text-gray-800 mb-4">내 예약 작업</h2>
            {Object.keys(tasks).length === 0 ? (
              <div className="text-center py-20 text-gray-300 font-bold">등록된 작업이 없습니다.</div>
            ) : (
              <div className="grid gap-4">
                {Object.values(tasks).map((task: any) => (
                  <div key={task.id} className={`p-6 rounded-3xl shadow-sm border-2 transition-all ${task.is_running ? 'bg-white border-blue-100' : 'bg-gray-50 border-transparent opacity-70'}`}>
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md mb-2 inline-block ${task.status === 'SUCCESS' ? 'bg-green-500 text-white' : (task.is_running ? 'bg-blue-600 text-white animate-pulse' : 'bg-gray-400 text-white')}`}>
                          {task.status}
                        </span>
                        <h3 className="text-xl font-black text-gray-800">{task.train_name}</h3>
                      </div>
                      <div className="text-right">
                        <span className="text-3xl font-black text-blue-600">{task.attempts?.toLocaleString() || 0}</span>
                        <span className="text-[10px] font-bold text-gray-400 block">시도 횟수</span>
                      </div>
                    </div>
                    <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                      <span className="text-xs text-gray-400 font-bold">마지막 확인: {task.last_check}</span>
                      <div className="flex gap-2">
                        {task.is_running && (
                          <button onClick={() => handleStopTask(task.id)} className="px-4 py-2 bg-red-50 text-red-600 font-bold rounded-xl hover:bg-red-600 hover:text-white transition-all text-xs">
                            중지
                          </button>
                        )}
                        {!task.is_running && (
                          <button onClick={() => handleDeleteTask(task.id)} className="px-4 py-2 bg-gray-100 text-gray-500 font-bold rounded-xl hover:bg-gray-200 transition-all text-xs">
                            삭제
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
              <h2 className="text-2xl font-black text-gray-800 mb-6">⚙️ 계정 설정</h2>
              <div className="bg-yellow-50 p-4 rounded-xl mb-6 text-xs text-yellow-700 leading-relaxed">
                <strong>주의:</strong> 코레일 계정 정보는 예약 매크로 실행을 위해 <strong>필수</strong>입니다. 
                정보는 데이터베이스에 저장되지만, 보안을 위해 개인용 서버에서만 사용하는 것을 권장합니다.
              </div>
              <form onSubmit={saveSettings} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 ml-1">코레일 회원번호</label>
                  <input type="text" value={korailId} onChange={e => setKorailId(e.target.value)} className="w-full p-4 border rounded-2xl text-black bg-gray-50 focus:ring-2 focus:ring-blue-500" placeholder="123456789" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 ml-1">코레일 비밀번호</label>
                  <input type="password" value={korailPw} onChange={e => setKorailPw(e.target.value)} className="w-full p-4 border rounded-2xl text-black bg-gray-50 focus:ring-2 focus:ring-blue-500" placeholder="비밀번호" />
                </div>
                <div className="pt-6 border-t border-gray-100">
                  <h3 className="text-lg font-bold text-gray-800 mb-4">알림 (선택)</h3>
                  <div className="space-y-5">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-2 ml-1">Telegram Bot Token</label>
                      <input type="text" value={tgToken} onChange={e => setTgToken(e.target.value)} className="w-full p-4 border rounded-2xl text-black bg-gray-50 focus:ring-2 focus:ring-blue-500" placeholder="12345..." />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-2 ml-1">Telegram Chat ID</label>
                      <input type="text" value={tgChatId} onChange={e => setTgChatId(e.target.value)} className="w-full p-4 border rounded-2xl text-black bg-gray-50 focus:ring-2 focus:ring-blue-500" placeholder="12345" />
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-gray-100">
                  <h3 className="text-lg font-bold text-gray-800 mb-4">앱 알림 (PWA)</h3>
                  <button type="button" onClick={handleEnablePush} className={`w-full py-4 font-bold rounded-2xl transition-all border-2 ${fcmToken ? 'bg-green-50 border-green-200 text-green-600' : 'bg-blue-50 border-blue-200 text-blue-600'}`}>
                    {fcmToken ? '✅ 푸시 알림 활성화됨' : '🔔 앱 푸시 권한 요청'}
                  </button>
                  {fcmToken && (
                    <button type="button" onClick={handleTestPush} className="w-full mt-2 py-3 bg-gray-100 text-gray-600 font-bold rounded-2xl hover:bg-gray-200 transition-all text-sm">
                      🧪 10초 뒤 알림 테스트
                    </button>
                  )}
                  <p className="mt-2 text-[10px] text-gray-400 text-center">브라우저 알림 권한 팝업이 뜨면 "허용"을 눌러주세요.</p>
                </div>

                <button type="submit" className="w-full py-4 bg-gray-900 text-white font-bold rounded-2xl hover:bg-black transition-all shadow-lg mt-4">
                  설정 저장
                </button>
              </form>
              <button onClick={handleLogout} className="w-full py-4 mt-4 text-red-500 font-bold text-sm hover:bg-red-50 rounded-2xl transition-all">
                로그아웃
              </button>
            </div>
          </div>
        )}
      </div>
      {message && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full text-xs font-bold shadow-2xl z-[60]">{message}</div>}
    </main>
  );
}