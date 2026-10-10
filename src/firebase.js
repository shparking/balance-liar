import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'

// Firebase 콘솔 > 프로젝트 설정 > 내 앱 에서 복사한 값
const firebaseConfig = {
  apiKey: 'AIzaSyDbV6dAgAdWP6q0MR3tACGQzCFjTRKvpEU',
  authDomain: 'juru-marvel.firebaseapp.com',
  projectId: 'juru-marvel',
  storageBucket: 'juru-marvel.firebasestorage.app',
  messagingSenderId: '194325503610',
  appId: '1:194325503610:web:04acff9dc6c7493a1565c3',
  // Realtime Database 주소. 콘솔 > Realtime Database > 데이터 탭 상단에 표시되는 URL
  // 위치를 미국(us-central1)으로 만들면 아래 기본값이 맞고, 다른 지역이면 그 URL로 바꿔주세요.
  databaseURL: import.meta.env.VITE_FIREBASE_DB_URL || 'https://juru-marvel-default-rtdb.firebaseio.com',
}

import { initDb, DEMO } from './db'

export const app = initializeApp(firebaseConfig)
export const db = DEMO ? null : getDatabase(app)
initDb(db)
