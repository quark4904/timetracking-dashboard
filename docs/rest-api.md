# REST API 사용 방법

현재 FastAPI 서버(`app/main.py`)에 구현된 API를 기준으로 작성한 문서입니다. 인증 설정과 외부 도메인 연결 절차는 다루지 않습니다.

## 접속 주소

앱에 접속하는 주소 뒤에 `/api/...`를 붙여 호출합니다.

- 로컬 기본 주소: `http://127.0.0.1:8010`
- 외부에서 호출할 때: 실제 앱 서버 주소로 바꿉니다. `127.0.0.1`은 호출하는 기기 자신을 의미합니다.
- FastAPI 대화형 명세: `/docs`, `/redoc`
- OpenAPI JSON 명세: `/openapi.json`

대화형 명세는 FastAPI 서버에서 제공하며, `dev_server.py` 개발 서버에서는 제공하지 않습니다.

이후 예제는 Bash 또는 Zsh에서 다음 변수를 설정한 뒤 실행합니다.

```bash
export BASE_URL='http://127.0.0.1:8010'
```

요청 본문은 JSON이며 `Content-Type: application/json`을 지정합니다. 응답도 JSON이지만, 세션 삭제 성공 시에는 본문이 없습니다. 아래 생성·수정·시작·중지 예제는 실제 데이터를 변경합니다. 조회 후 반환된 실제 ID로 예제의 ID를 바꾸세요.

## 빠른 사용 예제

### 1. 서버 상태 확인

```bash
curl -sS "$BASE_URL/api/health"
```

응답: `200 OK`, `{"ok": true}`

### 2. 작업 목록 조회

```bash
curl -sS "$BASE_URL/api/tasks"
```

응답은 작업 객체의 배열이며 작업이 없으면 `[]`입니다. 아래는 응답 형태 예시입니다.

```json
[
  {
    "id": 1,
    "name": "공부",
    "color": "#0a84ff",
    "category": "growth",
    "archived": 0,
    "notes": "",
    "sort_order": 1,
    "created_at": "2026-10-01T00:00:00+00:00",
    "total_seconds": 3600,
    "active_session_id": null
  }
]
```

`total_seconds`는 종료된 세션의 누적 시간(초)이며 진행 중인 세션은 제외합니다. `active_session_id`는 실행 중인 세션 ID이고, 없으면 `null`입니다. `archived`는 응답에서 정수 `0` 또는 `1`입니다.

### 3. 작업 생성

```bash
curl -sS -X POST "$BASE_URL/api/tasks" \
  -H 'Content-Type: application/json' \
  -d '{"name":"공부","color":"#0a84ff","category":"growth"}'
```

응답: `201 Created`, 생성된 작업 객체. 목록 응답의 `total_seconds`, `active_session_id`는 생성·수정 응답에 포함되지 않습니다.

### 4. 타이머 시작

생성 응답의 `id`가 `1`인 경우:

```bash
curl -sS -X POST "$BASE_URL/api/tasks/1/start"
```

응답: `201 Created`, 생성된 세션 객체.

```json
{
  "id": 10,
  "task_id": 1,
  "started_at": "2026-10-01T01:00:00+00:00",
  "ended_at": null,
  "notes": "",
  "task_name": "공부",
  "task_color": "#0a84ff",
  "task_category": "growth"
}
```

시작 시각은 서버의 현재 시각입니다. 이미 실행 중인 세션이 있으면 해당 세션을 종료하고 새 세션을 시작합니다. 같은 작업을 다시 시작해도 새 세션이 생기므로 자동 재시도에 주의하세요. 보관된 작업은 이 API로 시작할 수 없습니다.

### 5. 실행 중인 세션 확인 및 중지

```bash
curl -sS "$BASE_URL/api/sessions/active"
curl -sS -X POST "$BASE_URL/api/sessions/stop"
```

실행 중 조회는 `200 OK`와 세션 객체를 반환하며, 실행 중인 세션이 없으면 `200 OK`와 JSON `null`을 반환합니다. 중지는 `200 OK`와 종료된 세션 객체를 반환합니다. 중지할 세션이 없으면 `404 Not Found`입니다.

## API 목록

경로는 모두 서버 기본 주소 뒤에 붙입니다.

| 메서드 | 경로 | 기능 | 성공 응답 |
| --- | --- | --- | --- |
| GET | `/api/health` | 서버 상태 확인 | 200, `{"ok":true}` |
| GET | `/api/tasks` | 작업 목록 조회 | 200, 작업 배열 |
| POST | `/api/tasks` | 작업 생성 | 201, 작업 객체 |
| PATCH | `/api/tasks/{task_id}` | 작업 일부 수정 | 200, 작업 객체 |
| POST | `/api/tasks/reorder` | 전체 작업 순서 변경 | 200, 작업 배열 |
| DELETE | `/api/tasks/{task_id}` | 작업 및 해당 작업의 모든 세션 영구 삭제 | 200, `{"ok":true}` |
| POST | `/api/tasks/{task_id}/start` | 현재 시각에 타이머 시작 | 201, 세션 객체 |
| GET | `/api/sessions/active` | 실행 중인 세션 조회 | 200, 세션 객체 또는 `null` |
| POST | `/api/sessions/stop` | 실행 중인 세션 중지 | 200, 세션 객체 |
| GET | `/api/sessions` | 세션 목록 조회 | 200, 세션 배열 |
| POST | `/api/sessions` | 세션 수동 생성 | 201, 세션 객체 |
| PATCH | `/api/sessions/{session_id}` | 세션 수정 | 200, 세션 객체 |
| DELETE | `/api/sessions/{session_id}` | 세션 영구 삭제 | 204, 본문 없음 |
| GET | `/api/admin/db` | DB 경로 및 시간대 정보 조회 | 200, 메타데이터 객체 |

단일 작업·세션을 ID로 조회하는 GET API와 별도의 리포트 집계 API는 현재 없습니다. 목록 조회 결과에서 ID로 찾거나 세션 데이터를 집계해야 합니다. 목록 조회에는 페이지네이션이 없습니다.

## 작업 API 상세

### 목록 조회

기본적으로 보관된 작업은 제외합니다. 포함하려면:

```bash
curl -sS "$BASE_URL/api/tasks?include_archived=true"
```

### 생성·수정 필드

| 필드 | 타입 | 생성 시 | 수정 시 | 규칙 |
| --- | --- | --- | --- | --- |
| `name` | 문자열 | 필수 | 선택 | 앞뒤 공백 제거 후 1~80자 |
| `color` | 문자열 | 필수 | 선택 | `#0a84ff` 형태의 6자리 HEX 색상 |
| `category` | 문자열 | 선택, 기본 `growth` | 선택 | `growth`, `leisure`, `unclassified` |
| `archived` | boolean | 사용하지 않음 | 선택 | `true` 보관, `false` 복원 |
| `notes` | 문자열 | 사용하지 않음 | 선택 | 최대 2,000자 |

작업 수정은 보낸 필드만 변경합니다. `null`인 필드는 변경하지 않습니다. 메모를 지우려면 빈 문자열을 보냅니다.

```bash
curl -sS -X PATCH "$BASE_URL/api/tasks/1" \
  -H 'Content-Type: application/json' \
  -d '{"name":"독서","notes":"기술 서적 읽기","category":"growth"}'
```

작업을 보관하려면 `{"archived":true}`, 복원하려면 `{"archived":false}`를 같은 PATCH 경로로 보냅니다. 보관은 실행 중인 세션을 자동으로 중지하지 않습니다.

### 순서 변경

보관된 작업까지 포함한 **모든 작업 ID를 중복 없이** 원하는 순서대로 전달합니다. ID가 누락되거나 중복되면 `404`를 반환합니다.

```bash
curl -sS -X POST "$BASE_URL/api/tasks/reorder" \
  -H 'Content-Type: application/json' \
  -d '{"task_ids":[3,1,2]}'
```

### 삭제

작업 삭제는 해당 작업의 모든 시간 기록도 함께 영구 삭제합니다. 기록을 유지하려면 보관을 사용하세요.

```bash
curl -sS -X DELETE "$BASE_URL/api/tasks/1"
```

## 세션 API 상세

세션은 작업에 연결된 하나의 시간 기록입니다. 조회·생성·수정·시작·중지 응답의 세션 객체에는 `id`, `task_id`, `started_at`, `ended_at`, `notes`, `task_name`, `task_color`, `task_category`가 포함됩니다. 소요 시간 필드는 없으므로 종료 세션은 종료 시각에서 시작 시각을 빼서 계산합니다.

### 기간 조회

```bash
curl -sS --get "$BASE_URL/api/sessions" \
  --data-urlencode 'start=2026-10-01T00:00:00+09:00' \
  --data-urlencode 'end=2026-10-02T00:00:00+09:00'
```

- `start`와 `end`는 모두 생략하거나 함께 지정합니다. 생략하면 전체 세션을 조회합니다.
- 시간대가 포함된 ISO 8601 시각을 사용하며 `end`는 `start`보다 뒤여야 합니다.
- 조회 구간 `[start, end)`와 겹치는 세션을 시작 시각 내림차순으로 반환합니다. 보관된 작업의 세션도 포함합니다.
- 세션의 시간을 구간 경계로 잘라 반환하지 않습니다. 일별 집계 시에는 호출자가 겹치는 구간만 계산해야 합니다.
- 쿼리스트링의 `+09:00`이 올바르게 전달되도록 위 예제처럼 URL 인코딩합니다.

### 수동 생성

```bash
curl -sS -X POST "$BASE_URL/api/sessions" \
  -H 'Content-Type: application/json' \
  -d '{"task_id":1,"started_at":"2026-10-01T09:00:00+09:00","ended_at":"2026-10-01T10:00:00+09:00","notes":"독서"}'
```

위 예제는 해당 시간에 기존 기록이 없는 경우에만 성공합니다.

| 필드 | 타입 | 필수 여부 | 설명 |
| --- | --- | --- | --- |
| `task_id` | 정수 | 필수 | 연결할 기존 작업 ID |
| `started_at` | ISO 8601 문자열 | 필수 | 시간대가 포함된 시작 시각 |
| `ended_at` | ISO 8601 문자열 또는 `null` | 선택, 기본 `null` | 종료 시각. `null`이면 실행 중인 세션 |
| `notes` | 문자열 | 선택, 기본 빈 문자열 | 최대 2,000자 메모 |

### 수정

세션 수정은 PATCH이지만 **`task_id`와 `started_at`을 반드시 함께 보내야 합니다.** `ended_at`을 생략하면 `null`, `notes`를 생략하면 빈 문자열로 적용됩니다. 기존 값을 유지하려면 조회 결과의 값을 함께 보내세요. 변경하지 않는 시각은 원본 문자열을 사용해 초·소수점 정밀도를 보존하세요.

```bash
curl -sS -X PATCH "$BASE_URL/api/sessions/10" \
  -H 'Content-Type: application/json' \
  -d '{"task_id":1,"started_at":"2026-10-01T09:00:00+09:00","ended_at":"2026-10-01T10:00:00+09:00","notes":"메모 수정"}'
```

### 시간 규칙

- 입력 시각에는 `Z`, `+00:00`, `+09:00` 등 시간대가 필수입니다. 저장 및 응답 시각은 UTC입니다.
- 시작 시각은 미래일 수 없고, 종료 시각은 시작보다 뒤이며 현재 시각 이하여야 합니다.
- 수동 생성·수정 시 기존 세션과 시간 구간이 겹치면 `409`입니다. 종료와 다음 시작이 같은 경계는 허용합니다.
- 실행 중인 세션은 하나만 허용합니다. 수동 생성·수정으로 두 번째 실행 세션을 만들면 `409`입니다.
- `/api/tasks/{task_id}/start`는 기존 실행 세션을 자동 종료하지만, 수동 생성·수정은 충돌을 거부합니다.

### 삭제

해당 세션을 영구 삭제합니다.

```bash
curl -i -X DELETE "$BASE_URL/api/sessions/10"
```

성공 시 `204 No Content`이므로 JSON 파싱을 시도하지 않습니다.

## DB 정보 조회

```bash
curl -sS "$BASE_URL/api/admin/db"
```

응답 예시(Docker 기본 설정):

```json
{
  "db_path": "/app/data/timetracking.db",
  "storage_timezone": "UTC",
  "display_timezone": "Asia/Seoul"
}
```

DB 내용이나 백업 파일을 내려받는 API가 아니라 메타데이터 조회 API입니다.

## 오류 처리

| 상태 코드 | 의미 | 확인할 내용 |
| --- | --- | --- |
| 400 | 시간 값 또는 조회 범위 오류 | 미래 시각, 종료 순서, 조회 시작·종료 쌍 |
| 404 | 대상을 찾을 수 없음 | 작업·세션 ID, 보관된 작업 시작, 실행 세션 없음, 순서 변경 ID 목록 |
| 409 | 시간 기록 충돌 | 기존 세션과 겹침, 다른 실행 세션 존재 |
| 422 | FastAPI 요청 검증 실패 | 필수 필드, 자료형, 색상, 분류, 문자열 길이, 시간대 |

일반적인 오류 응답은 `{"detail":"Task not found"}` 형태입니다. FastAPI의 `422` 응답에서는 `detail`이 필드별 오류 배열입니다. 개발 서버는 일부 입력 오류를 `400`으로 반환하므로 외부 연동은 배포용 FastAPI 서버 기준으로 구현하는 것이 좋습니다.

`curl -i`를 사용하면 HTTP 상태 코드와 헤더를 함께 볼 수 있습니다. 자동화에서는 상태 코드를 확인한 다음 본문을 처리하세요. 생성·시작 같은 변경 요청은 응답을 받지 못했더라도 서버에서 처리됐을 수 있으므로, 재시도 전에 목록 또는 실행 상태를 조회하세요.
