# Mac codex-tracking 연동 정보

## 접속 및 인증

- 서버 기본 URL: `https://jm-n100.tail18eaf.ts.net:8443`
- API 기본 URL: `https://jm-n100.tail18eaf.ts.net:8443/api`
- Mac에서 Tailscale에 로그인하고 N100의 TCP 8443 접근이 tailnet 정책에서 허용되어 있어야 합니다.
- 앱 자체에는 API 키·Bearer 토큰·로그인 인증이 없습니다. Tailscale의 기기 인증과 접근 정책이 접근을 제한합니다. 이 주소에는 Cloudflare Access 헤더나 브라우저 로그인이 필요하지 않습니다.
- JSON 변경 요청은 `Content-Type: application/json`을 지정합니다. TLS 인증서는 정상 검증하며 `curl -k`는 사용하지 않습니다.
- 접근 가능한 tailnet 기기는 앱의 조회·변경 API를 모두 사용할 수 있습니다. Mac 한 대로만 제한하는 별도의 ACL 변경은 하지 않았습니다.

## Mac에서 읽기 전용 접속 확인

```bash
export BASE_URL='https://jm-n100.tail18eaf.ts.net:8443'
curl --fail-with-body --silent --show-error --connect-timeout 5 --max-time 15 "$BASE_URL/api/health"
curl --fail-with-body --silent --show-error --connect-timeout 5 --max-time 15 "$BASE_URL/api/tasks"
curl --fail-with-body --silent --show-error --connect-timeout 5 --max-time 15 --get "$BASE_URL/api/sessions" \
  --data-urlencode 'start=2026-10-21T00:00:00+09:00' \
  --data-urlencode 'end=2026-10-22T00:00:00+09:00'
```

상태 확인의 정상 응답은 HTTP 200과 `{"ok":true}`입니다. 태스크와 세션 조회는 JSON 배열을 반환합니다.

## 태스크 및 완료된 시간 기록

| 메서드 | 경로 | 사용 방법 |
| --- | --- | --- |
| GET | `/api/tasks` | 보관되지 않은 태스크 배열. 보관된 태스크까지 조회하려면 `?include_archived=true` |
| POST | `/api/sessions` | 기존 `task_id`, 시작·종료 시각, 메모로 완료 기록 생성. 성공 201 |
| GET | `/api/sessions` | 전체 세션 배열. `start`, `end`를 함께 지정하면 해당 구간과 겹치는 세션 조회 |
| PATCH | `/api/sessions/{session_id}` | 기존 기록 수정. 성공 200 |

아래 본문은 생성과 수정에 모두 사용하는 예시입니다. 실제 태스크 ID와 기록 시각으로 바꿉니다. 이 요청은 실제 데이터를 변경합니다.

```json
{
  "task_id": 1,
  "started_at": "2026-10-21T09:00:00+09:00",
  "ended_at": "2026-10-21T09:15:00+09:00",
  "notes": "codex-tracking"
}
```

```bash
# 생성: 반환된 id를 Mac 기록과 연결해 저장합니다.
curl --fail-with-body --silent --show-error -X POST "$BASE_URL/api/sessions" \
  -H 'Content-Type: application/json' \
  -d '{"task_id":1,"started_at":"2026-10-21T09:00:00+09:00","ended_at":"2026-10-21T09:15:00+09:00","notes":"codex-tracking"}'

# 수정: SESSION_ID를 실제 생성 응답의 id로 바꿉니다.
curl --fail-with-body --silent --show-error -X PATCH "$BASE_URL/api/sessions/SESSION_ID" \
  -H 'Content-Type: application/json' \
  -d '{"task_id":1,"started_at":"2026-10-21T09:00:00+09:00","ended_at":"2026-10-21T09:20:00+09:00","notes":"codex-tracking 수정"}'
```

- 완료 기록은 `ended_at`을 반드시 채웁니다. `/start`, `/stop`은 기존 실행 타이머에 영향을 주므로 완료 기록 업로드에는 사용하지 않습니다.
- PATCH에도 `task_id`, `started_at`이 필수입니다. `ended_at` 생략 시 실행 중 상태(`null`), `notes` 생략 시 빈 문자열이 됩니다. 보존할 값도 함께 보냅니다.
- 응답은 `id`, `task_id`, `started_at`, `ended_at`, `notes`, `task_name`, `task_color`, `task_category`를 포함합니다. 시간은 UTC이며 소요 시간은 종료 시각에서 시작 시각을 빼서 계산합니다.
- 입력 시간대가 필수이며, 시작·종료는 미래일 수 없고 종료는 시작보다 뒤여야 합니다. 태스크 구분 없이 기존 기록과 겹치면 409입니다.
- 조회는 실행 중인 세션도 포함하므로 완료 기록만 필요하면 `ended_at != null`로 필터링합니다. 결과는 시작 시각 내림차순이고 페이지네이션과 단일 ID GET은 없습니다.
- 기간 `[start, end)`와 겹치는 기록을 원래 시각 그대로 반환합니다. 쿼리의 `+09:00`은 URL 인코딩합니다.
- 생성 요청에는 중복 방지 키가 없습니다. 타임아웃 이후 POST를 자동 재전송하면 중복 또는 충돌이 발생할 수 있으므로 먼저 기록 목록을 대조합니다.
- 주요 오류: 400 시간 범위 오류, 404 없는 ID, 409 기록 충돌, 422 필드 검증 실패. 오류 본문은 `detail`을 확인합니다.

전체 필드와 오류 설명은 [REST API 문서](rest-api.md)를 참고하세요.

## N100 운영 설정 및 검증

2026-10-22에 다음 설정을 추가했습니다. Serve의 백그라운드 설정은 재부팅 후에도 유지됩니다.

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:8010
```

- 기존 443의 `/`, `/mcp` 핸들러는 변경 전과 동일합니다. 8443에서 앱 전체를 프록시하며 경로 접두어 변환은 없습니다.
- Funnel은 활성화하지 않았습니다. Serve는 tailnet 내부에서만 접근할 수 있습니다([공식 문서](https://tailscale.com/docs/reference/tailscale-cli/serve)).
- Docker는 `127.0.0.1:8010 → 8000`을 유지합니다. 앱 코드, 인증 코드, Cloudflare 설정, 운영 DB를 변경하거나 컨테이너를 재시작하지 않았습니다.
- N100에서 유효한 TLS 인증서로 새 HTTPS 주소를 호출해 `/api/health`, `/api/tasks`, `/api/sessions`, `/openapi.json` 모두 200을 확인했습니다. 태스크 6개, 세션 546개가 반환됐습니다. 운영 API에는 조회 요청만 보냈습니다.
- 기존 443 `/`는 200, `/mcp`는 변경 전후 동일한 405(GET 불허)였습니다. MCP 프로토콜 전체 동작 검증은 하지 않았습니다.
- Cloudflare 터널 서비스는 변경 전후 `active`입니다. 외부 Cloudflare Access 로그인 검증은 하지 않았습니다.
- Mac 원격 SSH 인증이 거부되어 Mac에서의 실제 접속은 미검증입니다. 위 읽기 전용 명령으로 최종 확인합니다.

새 연결만 해제하려면 N100에서 다음 명령을 사용합니다. 기존 443 경로는 유지됩니다.

```bash
tailscale serve --https=8443 off
```

전체 연결을 지우는 `tailscale serve reset`은 사용하지 않습니다.
