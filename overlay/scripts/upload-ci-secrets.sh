#!/usr/bin/env bash
# cward macOS CI 서명 시크릿 5개를 GitHub에 한 번에 등록한다. (최초 1회)
#
# 사전 준비 — Keychain 접근(Keychain Access) 앱에서 Developer ID 인증서를 .p12로 내보내기:
#   1) '로그인' 키체인 → '내 인증서' → "Developer ID Application: VOID (KR) (2S9H42VJUA)" 우클릭
#   2) "내보내기..." → 파일 형식 '개인 정보 교환(.p12)' → 저장(예: ~/Desktop/cward-devid.p12)
#   3) 내보낼 때 .p12 암호를 하나 정해 입력(아래 스크립트가 그 암호를 물어봄)
#
# 사용법:
#   bash overlay/scripts/upload-ci-secrets.sh ~/Desktop/cward-devid.p12
set -euo pipefail

REPO="hoony6134/cward"
P12="${1:?사용법: bash upload-ci-secrets.sh <DeveloperID.p12 경로>}"
P8="$HOME/.appstoreconnect/private_keys/AuthKey_JYS64MBFL2.p8"
ASC_KEY_ID="JYS64MBFL2"
ASC_ISSUER="d7ebe0d0-2e11-4997-9f4d-aa0d9f819e57"

[ -f "$P12" ] || { echo "✗ .p12를 찾을 수 없음: $P12"; exit 1; }
[ -f "$P8" ]  || { echo "✗ ASC API 키를 찾을 수 없음: $P8"; exit 1; }

read -r -s -p "내보낸 .p12 암호: " P12PW; echo

base64 -i "$P12" | tr -d '\n' | gh secret set CSC_LINK          --repo "$REPO"
printf %s "$P12PW"            | gh secret set CSC_KEY_PASSWORD   --repo "$REPO"
base64 -i "$P8"  | tr -d '\n' | gh secret set APPLE_API_KEY_P8   --repo "$REPO"
printf %s "$ASC_KEY_ID"       | gh secret set APPLE_API_KEY_ID   --repo "$REPO"
printf %s "$ASC_ISSUER"       | gh secret set APPLE_API_ISSUER   --repo "$REPO"

echo "✅ 시크릿 5개 등록 완료: CSC_LINK, CSC_KEY_PASSWORD, APPLE_API_KEY_P8, APPLE_API_KEY_ID, APPLE_API_ISSUER"
