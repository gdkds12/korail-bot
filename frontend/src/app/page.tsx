'use client';

import { useState, useEffect, useRef } from 'react';
import { auth, db, googleProvider, requestFcmToken } from '../lib/firebase';
import { signInWithPopup, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, setDoc, getDoc } from 'firebase/firestore';
import { getMessaging, onMessage } from 'firebase/messaging';
import { MagneticButton } from '@/components/magnetic-button';
import { useReveal } from '@/hooks/use-reveal';
import { format, addDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, isBefore, startOfDay } from 'date-fns';
import { ko } from 'date-fns/locale';

const VAPID_KEY = "BPNkW11fORIDrPxfHtKT8QM65DSp6jfW2gHrKBy-Dmtxbzd52vq4Lrf1FZaPCEwPNC8fbfGCSFjGYn5ReHhI_fQ";

const MAJOR_STATIONS = [
  '서울', '용산', '영등포', '광명', '수원', '천안아산', '오송', '대전', '김천구미', '동대구', '신경주', '울산', '부산',
  '포항', '마산', '창원중앙', '진주', '익산', '전주', '광주송정', '목포', '순천', '여수EXPO', '강릉', '평창', '안동'
].sort();

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  
  // States
  const [fcmToken, setFcmToken] = useState('');
  const [korailId, setKorailId] = useState('');
  const [korailPw, setKorailPw] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('search');
  
  // Search params
  const [dep, setDep] = useState('서울');
  const [arr, setArr] = useState('부산');
  const [displayDate, setDisplayDate] = useState(new Date());
  const [viewDate, setViewDate] = useState(new Date());
  const [time, setTime] = useState('06');
  const [interval, setInterval] = useState(3.0);
  const [trains, setTrains] = useState<any[]>([]);
  
  // UI States
  const [showStationPicker, setShowStationPicker] = useState<'dep' | 'arr' | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  
  // Tasks from Firestore
  const [tasks, setTasks] = useState<any>({});

  // Reveal effect
  const { ref: heroRef, isVisible: heroVisible } = useReveal(0.1);

  // Auto-hide message
  useEffect(() => {
    if (message) {
      const timeout = message.includes('코레일 서버 차단') ? 9000 : 3000;
      const timer = setTimeout(() => setMessage(''), timeout);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Auth & Initial Data Loading
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const messaging = getMessaging();
          onMessage(messaging, (payload) => {
            if (payload.notification) setMessage(`🔔 ${payload.notification.title}`);
          });
        } catch (e) {}

        const userRef = doc(db, 'users', u.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          setKorailId(data.korailId || '');
          setKorailPw(data.korailPw || '');
          setFcmToken(data.fcmToken || '');
          if (data.interval) setInterval(data.interval);
        }

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
      await setDoc(doc(db, 'users', user.uid), { korailId, korailPw, fcmToken, interval }, { merge: true });
      setMessage('✅ 설정이 저장되었습니다.');
    } catch (e) { setMessage('⚠️ 저장 실패'); }
  };

  const handleEnablePush = async () => {
    const token = await requestFcmToken(VAPID_KEY);
    if (token) {
      setFcmToken(token);
      setMessage('🔔 푸시 알림이 활성화되었습니다!');
    } else { setMessage('❌ 푸시 권한을 허용해야 합니다.'); }
  };

  const handleTestPush = async () => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'tasks'), {
        uid: user.uid, type: 'TEST_NOTIFICATION', is_running: true, status: 'PENDING',
        createdAt: new Date(), train_name: '테스트 열차'
      });
      setMessage('⏳ 10초 뒤에 알림이 발송됩니다...');
    } catch (e) { setMessage('❌ 요청 실패'); }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setTrains([]);
    setMessage('⏳ 조회 요청 중...');

    try {
      const reqRef = await addDoc(collection(db, 'search_requests'), {
        uid: user.uid,
        dep,
        arr,
        date: format(displayDate, 'yyyyMMdd'),
        time: time.padStart(2, '0') + '0000',
        createdAt: new Date(),
        status: 'PENDING'
      });

      const unsubscribe = onSnapshot(doc(db, 'search_requests', reqRef.id), (docSnap) => {
        const data = docSnap.data();
        if (data && data.status === 'COMPLETED') {
          setTrains(data.results || []);
          setMessage(`📅 ${data.results?.length || 0}개 열차 조회됨`);
          setLoading(false);
          unsubscribe();
        } else if (data && data.status === 'ERROR') {
          const macroBlocked = data.error_code === 'MACRO_BLOCK' || String(data.error || '').toLowerCase().includes('macro error');
          if (macroBlocked) {
            setMessage(`🚫 코레일 서버 차단: ${data.user_message || data.error || 'MACRO ERROR'}`);
          } else {
            setMessage(`❌ 오류: ${data.user_message || data.error || '조회 실패'}`);
          }
          setLoading(false);
          unsubscribe();
        }
      });

      setTimeout(() => {
        setLoading((currentLoading) => {
          if (currentLoading) setMessage('⚠️ 응답이 지연되고 있습니다...');
          return currentLoading;
        });
      }, 15000);
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
        uid: user.uid, train_no: train.train_no, train_name: train.train_name,
        dep_date: train.dep_date, dep_time: train.dep_time, dep_name: train.dep_name,
        arr_name: train.arr_name, interval: interval, is_running: true,
        status: 'RUNNING', attempts: 0, createdAt: new Date(), last_check: '-'
      });
      setMessage('🚀 예약 작업이 추가되었습니다.');
    } catch (e) { alert('⚠️ 작업 추가 실패'); }
  };

  const handleStopTask = async (taskId: string) => {
    try { await updateDoc(doc(db, 'tasks', taskId), { is_running: false, status: 'STOPPED' }); } catch (e) {}
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try {
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'tasks', taskId));
      setMessage('🗑️ 작업이 삭제되었습니다.');
    } catch (e) { setMessage('⚠️ 삭제 실패'); }
  };

  // Picker Modals
  const Modal = ({ isOpen, onClose, title, children }: any) => {
    if (!isOpen) return null;
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in duration-300">
        <div className="bg-white border border-foreground/10 w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 max-h-[85vh] flex flex-col">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-2xl font-light tracking-tight">{title}</h3>
            <button onClick={onClose} className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center text-xl hover:bg-foreground/10 transition-all">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {children}
          </div>
        </div>
      </div>
    );
  };

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-background overflow-hidden text-black">
        <div ref={heroRef} className={`w-full max-w-xl text-center transition-all duration-1000 ${heroVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'}`}>
          <h1 className="text-6xl md:text-8xl font-light tracking-tighter mb-4">코레일<span className="text-foreground/30">봇</span></h1>
          <p className="text-lg md:text-2xl font-light text-foreground/60 mb-12 tracking-tight">가장 빠르고 편한 기차 예매 자동화</p>
          <div className="flex flex-col gap-4 items-center px-6">
            <MagneticButton size="lg" onClick={handleLogin} className="w-full max-w-xs py-6 text-base">Google 계정으로 시작하기</MagneticButton>
          </div>
          {message && <p className="mt-8 text-sm font-medium text-red-500 animate-pulse">{message}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background pb-24 font-sans selection:bg-foreground selection:text-background text-black">
      {/* Pickers */}
      <Modal isOpen={!!showStationPicker} onClose={() => setShowStationPicker(null)} title={showStationPicker === 'dep' ? '출발역' : '도착역'}>
        <div className="grid grid-cols-3 gap-3">
          {MAJOR_STATIONS.map((s) => (
            <button key={s} onClick={() => { if (showStationPicker === 'dep') setDep(s); else setArr(s); setShowStationPicker(null); }}
              className={`py-4 rounded-2xl text-sm transition-all ${(showStationPicker === 'dep' ? dep : arr) === s ? 'bg-foreground text-background font-bold' : 'bg-foreground/5 hover:bg-foreground/10'}`}>{s}</button>
          ))}
        </div>
      </Modal>

      <Modal isOpen={showDatePicker} onClose={() => setShowDatePicker(false)} title="날짜 선택">
        <div className="flex flex-col space-y-4">
          <div className="flex justify-between items-center px-2">
            <h4 className="text-lg font-bold">{format(viewDate, 'yyyy년 M월', { locale: ko })}</h4>
            <div className="flex gap-2">
              <button onClick={() => setViewDate(subMonths(viewDate, 1))} className="p-2 rounded-full hover:bg-foreground/5 transition-all">←</button>
              <button onClick={() => setViewDate(addMonths(viewDate, 1))} className="p-2 rounded-full hover:bg-foreground/5 transition-all">→</button>
            </div>
          </div>
          
          <div className="grid grid-cols-7 gap-1">
            {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
              <div key={day} className="h-10 flex items-center justify-center text-[10px] font-bold text-foreground/30 uppercase tracking-widest">{day}</div>
            ))}
            {(() => {
              const startPos = startOfWeek(startOfMonth(viewDate));
              const endPos = endOfWeek(endOfMonth(viewDate));
              const days = eachDayOfInterval({ start: startPos, end: endPos });
              const today = startOfDay(new Date());

              return days.map((date, i) => {
                const isSelected = isSameDay(date, displayDate);
                const isCurrentMonth = isSameMonth(date, viewDate);
                const isPast = isBefore(date, today);
                const isPossible = !isPast && isBefore(date, addDays(today, 31));

                return (
                  <button
                    key={i}
                    disabled={!isPossible}
                    onClick={() => {
                      setDisplayDate(date);
                      setShowDatePicker(false);
                    }}
                    className={`h-12 w-full rounded-xl flex flex-col items-center justify-center text-sm transition-all
                      ${isSelected ? 'bg-foreground text-background font-bold scale-95 shadow-lg' : 
                        isPossible ? 'hover:bg-foreground/5 text-foreground' : 'text-foreground/10 cursor-not-allowed'}
                      ${!isCurrentMonth && isPossible ? 'opacity-30' : ''}
                    `}
                  >
                    <span>{format(date, 'd')}</span>
                  </button>
                );
              });
            })()}
          </div>
          <div className="pt-4 text-[10px] font-bold text-foreground/20 uppercase tracking-widest text-center">
            최대 31일 후까지 조회 가능합니다.
          </div>
        </div>
      </Modal>

      <Modal isOpen={showTimePicker} onClose={() => setShowTimePicker(false)} title="시간 선택">
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map((h) => (
            <button key={h} onClick={() => { setTime(h); setShowTimePicker(false); }}
              className={`py-4 rounded-2xl text-sm transition-all ${time === h ? 'bg-foreground text-background font-bold' : 'bg-foreground/5 hover:bg-foreground/10'}`}>{h}시</button>
          ))}
        </div>
      </Modal>
      
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-foreground/5">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-center h-20 md:h-24">
          <div className="flex gap-2 bg-foreground/5 p-1.5 rounded-full w-full max-w-md">
            {[{ id: 'search', label: '열차 조회' }, { id: 'manage', label: `매크로 관리` }, { id: 'settings', label: '설정' }].map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-3 md:py-4 rounded-full text-xs md:text-sm font-bold transition-all ${activeTab === tab.id ? 'bg-background text-foreground shadow-md' : 'text-foreground/40 hover:text-foreground'}`}>
                {tab.id === 'manage' ? `${tab.label} (${Object.values(tasks).filter((t: any) => t.is_running).length})` : tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 md:px-6 mt-8 md:mt-12">
        {activeTab === 'search' ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-foreground/10 pb-8">
              <div className="space-y-1">
                <h2 className="text-3xl md:text-5xl font-light tracking-tighter">열차 검색</h2>
                <p className="text-sm md:text-base text-foreground/40 font-light">여정을 계획하고 예약을 시작하세요.</p>
              </div>
              
              <form onSubmit={handleSearch} className="flex flex-col gap-6 bg-foreground/[0.03] p-6 md:p-8 rounded-[2rem] border border-foreground/5 w-full shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 flex flex-col items-center">
                    <label className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest mb-2">출발</label>
                    <button type="button" onClick={() => setShowStationPicker('dep')} className="text-2xl md:text-4xl font-bold hover:text-blue-600 transition-colors">{dep}</button>
                  </div>
                  <div className="pt-6"><span className="text-foreground/10 text-3xl font-light">→</span></div>
                  <div className="flex-1 flex flex-col items-center">
                    <label className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest mb-2">도착</label>
                    <button type="button" onClick={() => setShowStationPicker('arr')} className="text-2xl md:text-4xl font-bold hover:text-blue-600 transition-colors">{arr}</button>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-foreground/5">
                  <button type="button" onClick={() => setShowDatePicker(true)} className="flex flex-col items-start p-4 bg-background rounded-2xl border border-foreground/5 hover:bg-foreground/[0.02] transition-all">
                    <label className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest mb-1">날짜</label>
                    <span className="text-base font-medium">{format(displayDate, 'M월 d일 (eee)', { locale: ko })}</span>
                  </button>
                  <button type="button" onClick={() => setShowTimePicker(true)} className="flex flex-col items-start p-4 bg-background rounded-2xl border border-foreground/5 hover:bg-foreground/[0.02] transition-all">
                    <label className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest mb-1">시간</label>
                    <span className="text-base font-medium">{time}시 이후</span>
                  </button>
                </div>

                <MagneticButton type="submit" disabled={loading} className="w-full py-5 text-lg shadow-lg">{loading ? '조회 중...' : '열차 조회하기'}</MagneticButton>
              </form>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {trains.map((train, i) => (
                <div key={i} className="group bg-foreground/[0.02] border border-foreground/5 rounded-[2rem] p-6 md:p-8 transition-all hover:bg-foreground/[0.04]">
                  <div className="flex justify-between items-start mb-6">
                    <div className="px-3 py-1 rounded-full bg-foreground/5 text-[10px] font-bold tracking-widest text-foreground/40 uppercase">{train.train_name}</div>
                    <div className={`text-xs font-bold ${train.reserve_possible ? 'text-green-600' : 'text-foreground/20'}`}>{train.general_seat}</div>
                  </div>
                  <div className="flex items-center gap-4 mb-8">
                    <span className="text-3xl md:text-4xl font-light tracking-tighter">{train.dep_time.substring(8, 10)}:{train.dep_time.substring(10, 12)}</span>
                    <div className="flex-1 h-px bg-foreground/10 relative"><div className="absolute right-0 -top-1 w-2 h-2 rounded-full bg-foreground/20" /></div>
                    <span className="text-3xl md:text-4xl font-light tracking-tighter text-foreground/40">{train.arr_time.substring(8, 10)}:{train.arr_time.substring(10, 12)}</span>
                  </div>
                  <MagneticButton variant="secondary" onClick={() => handleReserveLoop(train)}
                    disabled={Object.values(tasks).some((t: any) => t.is_running && t.train_no === train.train_no)}
                    className="w-full py-4 text-xs tracking-widest uppercase shadow-sm">
                    {Object.values(tasks).some((t: any) => t.is_running && t.train_no === train.train_no) ? '감시 중' : '예약 대기'}
                  </MagneticButton>
                </div>
              ))}
              {trains.length === 0 && !loading && <div className="col-span-full py-20 text-center text-foreground/20 font-light italic">조회된 열차가 없습니다.</div>}
            </div>
          </div>
        ) : activeTab === 'manage' ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="border-b border-foreground/10 pb-8">
              <h2 className="text-3xl md:text-5xl font-light tracking-tighter">활성 작업</h2>
              <p className="text-sm md:text-base text-foreground/40 font-light mt-2">자동 예약 매크로의 실시간 현황입니다.</p>
            </div>
            {Object.keys(tasks).length === 0 ? (
              <div className="text-center py-20 border-2 border-dashed border-foreground/5 rounded-[2rem]"><p className="text-foreground/20 text-lg font-light italic">진행 중인 작업이 없습니다.</p></div>
            ) : (
              <div className="grid gap-4">
                {Object.values(tasks).map((task: any) => (
                  <div key={task.id} className={`group p-6 md:p-10 rounded-[2.5rem] border-2 transition-all ${task.is_running ? 'bg-foreground/[0.02] border-foreground/5' : 'bg-transparent border-foreground/5 opacity-50'}`}>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                      <div className="flex items-center gap-6">
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl ${task.status === 'SUCCESS' ? 'bg-green-500/10 text-green-500' : (task.is_running ? 'bg-foreground/5 text-foreground animate-pulse' : 'bg-foreground/5 text-foreground/20')}`}>
                          {task.status === 'SUCCESS' ? '✓' : '⚡'}
                        </div>
                        <div>
                          <span className="text-[10px] font-bold tracking-widest text-foreground/30 uppercase block mb-1">{task.status}</span>
                          <h3 className="text-2xl md:text-3xl font-light tracking-tight">{task.train_name}</h3>
                        </div>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-5xl md:text-6xl font-light tracking-tighter">{task.attempts || 0}</span>
                        <span className="text-xs font-bold tracking-widest text-foreground/30 uppercase">회 시도</span>
                      </div>
                      <div className="flex gap-2">
                        {task.is_running ? <MagneticButton variant="ghost" onClick={() => handleStopTask(task.id)} className="text-red-500 px-8 py-4">정지</MagneticButton>
                          : <MagneticButton variant="ghost" onClick={() => handleDeleteTask(task.id)} className="text-foreground/40 px-8 py-4">삭제</MagneticButton>}
                      </div>
                    </div>
                    <div className="mt-8 pt-8 border-t border-foreground/5 flex justify-between text-[10px] font-bold tracking-widest text-foreground/20 uppercase">
                      <span>ID: {task.id.substring(0, 8)}</span><span>최근 확인: {task.last_check}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-2xl mx-auto">
            <div className="text-center space-y-4 mb-8">
              <h2 className="text-3xl md:text-5xl font-light tracking-tighter">설정</h2>
              <p className="text-sm md:text-base text-foreground/40 font-light">계정 및 앱 옵션을 관리합니다.</p>
            </div>
            <div className="bg-foreground/[0.02] border border-foreground/5 rounded-[3rem] p-8 md:p-12 space-y-12">
              <form onSubmit={saveSettings} className="space-y-10">
                <div className="space-y-4">
                  <label className="text-[10px] font-bold tracking-widest text-foreground/30 uppercase ml-2">코레일 계정</label>
                  <input type="text" value={korailId} onChange={e => setKorailId(e.target.value)} className="w-full bg-foreground/5 border-none rounded-xl p-5 text-lg font-light focus:ring-2 focus:ring-foreground/10 transition-all" placeholder="회원번호" />
                  <input type="password" value={korailPw} onChange={e => setKorailPw(e.target.value)} className="w-full bg-foreground/5 border-none rounded-xl p-5 text-lg font-light focus:ring-2 focus:ring-foreground/10 transition-all" placeholder="비밀번호" />
                </div>
                <div className="space-y-4 pt-8 border-t border-foreground/5">
                  <label className="text-[10px] font-bold tracking-widest text-foreground/30 uppercase ml-2">매크로 빈도</label>
                  <div className="flex justify-between items-center mb-2"><span className="text-sm font-light">조회 간격</span><span className="text-lg font-bold">{interval}초</span></div>
                  <input type="range" min="0.5" max="10" step="0.1" value={interval} onChange={e => setInterval(parseFloat(e.target.value))} className="w-full h-2 bg-foreground/10 rounded-lg appearance-none cursor-pointer accent-foreground" />
                </div>
                <div className="pt-8 border-t border-foreground/5 space-y-4">
                  <label className="text-[10px] font-bold tracking-widest text-foreground/30 uppercase ml-2">알림</label>
                  <MagneticButton type="button" variant={fcmToken ? 'secondary' : 'primary'} onClick={handleEnablePush} className="w-full py-5">{fcmToken ? '✓ 앱 푸시 활성화됨' : '앱 푸시 권한 요청'}</MagneticButton>
                  {fcmToken && <button type="button" onClick={handleTestPush} className="w-full text-[10px] font-bold tracking-widest text-foreground/20 uppercase hover:text-foreground transition-all">알림 테스트 (10초 대기)</button>}
                </div>
                <MagneticButton type="submit" className="w-full py-6 text-lg shadow-xl">설정 저장</MagneticButton>
              </form>
              <div className="pt-8 border-t border-foreground/5 flex justify-center"><button onClick={handleLogout} className="text-xs font-bold tracking-widest text-red-500/40 hover:text-red-500 uppercase">로그아웃</button></div>
            </div>
          </div>
        )}
      </div>
      {message && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-8 duration-500 w-[90%] md:w-auto text-center"><div className="bg-foreground text-background px-8 py-4 rounded-full text-xs font-bold tracking-widest uppercase shadow-2xl backdrop-blur-xl">{message}</div></div>}
    </main>
  );
}
