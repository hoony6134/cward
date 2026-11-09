# cward overlay (macOS)

맥에서 돌아가는 cward 데스크톱 앱. **터미널 없이** 폰 연동(QR)과 **인게임 오버레이**(빌드 추천)를 한 앱에서 제공한다. 기존 agent 루프를 그대로 품고 있어 폰 companion도 계속 작동한다.

## 요구사항
- **League 클라이언트 그래픽 설정 → 창 모드를 "테두리 없음(Borderless)"** 으로. 진짜 전체화면은 맥에서 별도 Space라 오버레이가 위에 못 뜬다.
- Node 18+ (개발 실행용), macOS.

## 실행 (개발)
```bash
cd overlay
npm install
npm start          # 렌더러 빌드 후 Electron 실행
```
- 첫 실행 시 **QR 창**이 뜬다. 폰 카메라로 스캔 → 바로 연동(설정은 `~/Library/Application Support/cward-overlay/cward.config.json`에 자동 생성).
- 메뉴바(트레이) 아이콘: 폰 QR 다시 보기 · 오버레이 표시/숨김 · 조작 모드 · 종료.

## 단축키
| 키 | 동작 |
|---|---|
| `⌘⇧O` | 오버레이 표시/숨김 (수동) |
| `⌘⇧I` | 조작 모드 (클릭 통과 ↔ 클릭/드래그 가능) |

- 기본은 **클릭 통과** — 오버레이를 뚫고 게임이 클릭된다. 패널을 옮기거나 스펠 쿨을 클릭하려면 조작 모드로.
- 오버레이는 인게임이면 자동 표시, 게임을 나가면 자동 숨김(수동 토글 시 그 상태 유지).
- 게임 없이 오버레이를 확인하려면: `CWARD_SHOW_OVERLAY=1 npm start`.

## 배포 (.dmg)
```bash
npm run dist       # electron-builder → dist/ 에 .dmg
```
미서명 빌드라 처음엔 Gatekeeper가 막는다. **우클릭 → 열기**, 또는:
```bash
xattr -dr com.apple.quarantine "/Applications/cward.app"
```

## 데이터 소스
- **라이브**: League Live Client `:2999`(인게임) + LCU(로비/챔프선택) — 기존 agent 그대로.
- **빌드 추천**: OP.GG MCP(`lol_get_champion_analysis`) — 아이템·선마·룬·스펠 + 승률. 일반/칼바람/URF/넥서스 블리츠 지원.
- **아이콘/정적**: Data Dragon + CommunityDragon (`web/src/ddragon.ts` 재사용).
- **증강(칼바람 아수라장 / Mayhem)**: 작업 예정 — OP.GG MCP엔 없어 OP.GG 웹/ lol.ps 소스를 실게임 캡처로 붙일 계획.

## 구조
- `src/main.mjs` — Electron 메인: 트레이, 세 창(오버레이·페어링), agent 루프, 단축키, 추천 캐시+IPC.
- `src/config.mjs` — userData 설정(최초 실행 시 room/token 생성).
- `src/reco/opgg.mjs` — OP.GG MCP 빌드 패처(+ `opgg.test.mjs` fixture 테스트).
- `renderer/overlay.tsx` — 오버레이 HUD(React, `@web/ddragon` 재사용).
- `renderer/pairing.html` — QR 페어링 창.
- 재사용: `../agent/src/*`(agent 루프·LCU·relay), `../shared/*`(스냅샷 셰이퍼), `../web/src/ddragon.ts`.
