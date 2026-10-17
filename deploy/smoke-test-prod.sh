#!/bin/bash
# Isolated production smoke test: Better Auth signup, social-only onboarding,
# project/source persistence, and cross-user isolation. No AI-generation calls.
# Uses throwaway users (deleted afterward) - never prints the password.
set -euo pipefail

BASE="http://localhost:4002"
TS=$(date -u +%s)
EMAIL_A="prod-smoke-a-${TS}@growthforge.test"
EMAIL_B="prod-smoke-b-${TS}@growthforge.test"
PASS_A="SmokeA!$(openssl rand -hex 8)"
PASS_B="SmokeB!$(openssl rand -hex 8)"
CKA=$(mktemp); CKB=$(mktemp)
IDS=/tmp/prod-smoke-ids.txt

jqget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d$1'))" 2>/dev/null; }

echo "[1] Better Auth health"
curl -s -o /dev/null -w "    /api/auth/ok -> %{http_code}\n" "$BASE/api/auth/ok"

echo "[2] Sign up user A"
RA=$(curl -s -c "$CKA" -X POST "$BASE/api/auth/sign-up/email" \
  -H "Content-Type: application/json" -H "Origin: https://usegrowthforge.com" \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"$PASS_A\",\"name\":\"Prod Smoke A\"}")
UA=$(echo "$RA" | python3 -c "import sys,json;print(json.load(sys.stdin)['user']['id'])" 2>/dev/null || echo "?")
echo "    user A id: $UA"

echo "[3] User A onboarding (social-only creator, no AI)"
RESP=$(curl -s -b "$CKA" -X POST "$BASE/api/onboarding" \
  -H "Content-Type: application/json" -H "Origin: https://usegrowthforge.com" \
  -d '{"businessName":"Prod Smoke Creator","sourceType":"instagram","sourceUrl":"instagram.com/prod-smoke","operatingModel":"creator","declaredDescription":"A test creator for prod smoke testing.","primaryGoal":"Grow audience"}')
PROJ_A=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['project']['id'])" 2>/dev/null || echo "?")
echo "    project id: $PROJ_A"

echo "[4] User A can read own project (expect 200)"
CODE=$(curl -s -b "$CKA" -o /dev/null -w "%{http_code}" "$BASE/api/projects/$PROJ_A")
echo "    GET /projects/$PROJ_A -> $CODE"

echo "[5] Sign up user B"
RB=$(curl -s -c "$CKB" -X POST "$BASE/api/auth/sign-up/email" \
  -H "Content-Type: application/json" -H "Origin: https://usegrowthforge.com" \
  -d "{\"email\":\"$EMAIL_B\",\"password\":\"$PASS_B\",\"name\":\"Prod Smoke B\"}")
UB=$(echo "$RB" | python3 -c "import sys,json;print(json.load(sys.stdin)['user']['id'])" 2>/dev/null || echo "?")
echo "    user B id: $UB"

echo "[6] Cross-user isolation: user B reads user A project (expect 404)"
CODE=$(curl -s -b "$CKB" -o /dev/null -w "%{http_code}" "$BASE/api/projects/$PROJ_A")
echo "    GET /projects/$PROJ_A as user B -> $CODE"

echo "[7] Unauthenticated read (expect 401)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/projects/$PROJ_A")
echo "    GET /projects/$PROJ_A (no cookie) -> $CODE"

rm -f "$CKA" "$CKB"
{
  echo "EMAIL_A=$EMAIL_A"
  echo "EMAIL_B=$EMAIL_B"
  echo "USER_A=$UA"
  echo "USER_B=$UB"
  echo "PROJ_A=$PROJ_A"
} > "$IDS"
echo "smoke ids written to $IDS"
echo "DONE"
