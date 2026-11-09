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
- 메뉴바(트레이) 아이콘: 폰 QR 다시 보기 · 위치 편집 모드 · 종료.

## 오버레이 패널
- **상대 스펠·궁 쿨**(좌측): 적 소환사 주문 + 궁 쿨(클릭해서 수동 카운트).
- **추천 아이템**(우하단): OP.GG 코어템 + 승률. 이미 산 아이템은 회색 + ✓.
- **선마 링**: 게임 기본 스킬바 위에 올리는 투명 핑크 링 — 다음 찍을 스킬 표시(처음에 스킬바 위치로 한 번 맞춰 두기).
- **증강 티어**(아수라장/Mayhem): Blitz 데이터 기반 S/A/B/C/D, 검색 가능. 기본 접힘("▸ 열기").

## 조작
- 평소 오버레이는 **완전히 클릭 통과** — 게임 플레이에 전혀 지장 없음. 게임 중엔 항상 표시되고 끌 일이 없다.
- **`⌘⇧E` = 위치 편집 모드.** 켜면 패널을 드래그해 배치(제목 더블클릭 = 기본 위치로 리셋), 다시 `⌘⇧E`로 잠근다. (편집 중엔 상단에 파란 배너.)
- 게임 없이 오버레이 미리보기: `CWARD_SHOW_OVERLAY=1 npm start`.

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
- **증강 티어(칼바람 아수라장 / Mayhem)**: Blitz 백엔드(iesdev) — 증강별 S/A/B/C/D 티어 + 한국어 이름/설명. (OP.GG MCP·CommunityDragon엔 Mayhem 증강이 없음.)
- **아이콘/정적**: Data Dragon + CommunityDragon (`web/src/ddragon.ts` 재사용).

## 구조
- `src/main.mjs` — Electron 메인: 트레이, 세 창(오버레이·페어링), agent 루프, 단축키, 추천 캐시+IPC.
- `src/config.mjs` — userData 설정(최초 실행 시 room/token 생성).
- `src/reco/opgg.mjs` — OP.GG MCP 빌드 패처(+ `opgg.test.mjs` fixture 테스트).
- `src/reco/augments.mjs` — Blitz(iesdev) Mayhem 증강 티어 패처.
- `renderer/overlay.tsx` — 오버레이 HUD(React, `@web/ddragon` 재사용).
- `renderer/pairing.html` — QR 페어링 창.
- 재사용: `../agent/src/*`(agent 루프·LCU·relay), `../shared/*`(스냅샷 셰이퍼), `../web/src/ddragon.ts`.
