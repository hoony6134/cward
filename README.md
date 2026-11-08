# LoL Companion (나만의 버전)

로컬 PC에서 League의 **Live Client Data API**(`:2999`, 인증 불필요)를 읽어, 무료
Cloudflare 릴레이를 거쳐 **폰에서 리치한 인게임 정보**를 한국어로 봅니다.

```
League (:2999)  →  agent (headless, 로컬)  →  Cloudflare Worker+DO (룸 릴레이, wss)  →  web (폰, Pages)
```

- **무료**: Workers 무료 플랜의 Durable Objects(SQLite + WebSocket Hibernation) + Pages 정적 호스팅.
- **안전**: wss(TLS) + 룸별 공유 토큰. 토큰은 URL 프래그먼트로만 폰에 전달돼 서버 로그에 남지 않음.
- **가벼움**: 에이전트는 창 없이 1.5초 간격 폴링(조정 가능). 게임 성능 영향 최소.

## 1. 릴레이 배포 (worker)

```bash
cd worker && npm install
npx wrangler login
npx wrangler secret put ROOM_TOKEN   # 긴 랜덤 문자열 입력
npm run deploy                        # 출력된 https://...workers.dev 주소 확인
```

## 2. 폰 UI 배포 (web, Cloudflare Worker + 정적 에셋)

```bash
cd web && npm install
echo 'VITE_RELAY_WS_URL=wss://relay.<your-domain>/ws' > .env   # 1번 Worker 주소
npm run deploy   # build 후 wrangler deploy (ward-web Worker). 도메인/라우트는 web/wrangler.jsonc 참고
```

## 3. 로컬 에이전트 (agent)

```bash
cd agent && npm install
npm run init   # 새 방(ROOM)을 자동 생성하고, 묻는 자리에 ROOM_TOKEN(1번에서 넣은 값)만 붙여넣기
npm start
```

> 친구에게 줄 때: 이 레포 주소 + `ROOM_TOKEN` 값만 따로 알려주면 됩니다. 친구는 위 3·4단계만 하면 되고(`npm run init` 이 각자 다른 방을 만들어 줍니다), 토큰은 공개 레포에 올리지 마세요(`.env` 는 이미 gitignore).

## 4. 폰 페어링

터미널에서 한 번만 치면 QR + 링크가 뜹니다(토큰이 localStorage에 저장돼 다음부터 자동 연결):

```bash
cd agent && npm run qr
```

폰 카메라로 QR을 스캔하거나 링크를 열면 끝. (링크만: `node scripts/pairing-link.mjs`)

## 기능

- **인게임**: 양팀 스코어보드(공식 Riot 이미지), 체력/마나/골드/스킬, 오브젝트, 이벤트 피드, **상대 스펠/궁 쿨 타이머(수동 체크)**, 추천 아이템(Riot 기본).
- **로비**: 게임 모드 선택, 포지션 1·2순위, 매칭 시작/취소 — 폰에서 조작.
- **챔프 선택**: 타이머, 픽/밴(검색+확정), 밴 현황 — 폰에서 조작.
- **매칭 수락**: 폰에서 수락/거절.

## 범위 / 한계

- Live Client / LCU 필드는 패치로 바뀔 수 있음.
- 증강(아레나) 추천 티어는 외부 데이터 필요 — 미포함.
- 궁 쿨은 기본 100초(랭크별 정확값 미반영).
- 토큰은 개인용 공유 시크릿(단일). 링크를 아는 사람은 조작 가능 — 공유 주의.
