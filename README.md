# Timetracking Dashboard

FastAPI 기반의 개인 시간 추적 대시보드입니다. 모바일 참고 UI를 웹에 맞게 확장해 Tasks, Timeline, Reports, Settings 화면을 제공합니다.

## 로컬 실행

Python 3.12 사용을 권장합니다. 현재 FastAPI/Pydantic 조합은 Python 3.14 로컬 환경에서 네이티브 의존성 빌드가 실패할 수 있습니다.

```bash
python3.12 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8010
```

FastAPI 의존성을 설치하기 어려운 환경에서는 표준 라이브러리 기반 개발 서버를 사용할 수 있습니다.

```bash
python3 dev_server.py
```

개발 서버는 기본적으로 `127.0.0.1:8010`에서만 접근할 수 있습니다. 다른 장치의 직접 접근이 필요한 경우에만 `TIMETRACKING_HOST`를 설정합니다. 직접 접근에는 Cloudflare Access 인증이 적용되지 않습니다.

## 테스트

저장소 테스트는 별도 테스트 라이브러리 없이 실행할 수 있습니다.

```bash
python3 -m unittest discover -v
node tests/test_frontend_math.mjs
```

`tests/test_http_api.py`는 로컬 개발 서버 소켓을 사용하므로 샌드박스 환경에서는 권한 확장이 필요할 수 있습니다.

배포용 FastAPI 검증과 브라우저 회귀 테스트는 가상환경에 테스트 의존성을 설치한 뒤 실행합니다. 운영 Docker 이미지에는 테스트 의존성을 설치하지 않습니다.

```bash
pip install -r requirements-test.txt
python -m unittest discover -v
python -m playwright install chromium
python -m unittest tests.browser_checks -v
```

FastAPI 테스트는 `fastapi` 또는 `httpx`가 없으면 skip으로 표시됩니다. 브라우저 테스트는 별도로 실행하며 Chromium에서 시각 보존·월말 이동·지연 응답·새 세션 저장을, 모바일 뷰포트에서 편집·Tab 순서·Stop 동작을 확인합니다. 모든 API/브라우저 테스트는 임시 DB를 사용합니다. 모바일 테스트도 Chromium 엔진이므로 실제 iOS Safari 검증을 대체하지 않습니다.

## 정적 파일 캐시

CSS, 메인 JavaScript, JavaScript 모듈의 SHA-256 앞 12자리를 정적 URL의 쿼리스트링에 자동 반영합니다.

Docker 빌드에서는 자동 실행됩니다. 로컬 정적 파일 수정 후에는 아래 명령을 실행합니다. `date-time.mjs` → `reporting.mjs` → `app.js` → `index.html` 순서로 모듈 간 참조까지 갱신합니다.

```bash
python3 scripts/update_static_versions.py
```

## Docker 실행

```bash
docker compose up --build -d
```

브라우저에서 `http://localhost:8010`으로 접속합니다. Ubuntu 서버에서는 Cloudflare Tunnel의 origin을 `http://localhost:8010`으로 지정하면 됩니다.

## 기술 선택

FastAPI는 이 프로젝트에 잘 맞습니다. API, 정적 파일 서빙, SQLite 연동, Docker 배포가 단순하고 추후 모바일 앱이나 자동화 연동을 붙이기 쉽습니다. 대안으로는 Next.js 풀스택 앱도 좋지만, 개인 서버에서 가볍게 운영하고 Python으로 데이터 처리/리포트를 확장하려면 FastAPI가 더 단순합니다.

## 시간 및 데이터 정책

- 모든 시각은 UTC로 저장하고 화면과 리포트에서는 `Asia/Seoul` 기준으로 표시합니다.
- 자정을 넘는 세션은 일·주·월·연 리포트의 각 시간 구간에 나누어 집계합니다.
- 동시에 실행 중인 세션은 하나만 허용합니다. 새 작업을 시작하면 기존 활성 세션이 종료됩니다.
- 수동으로 입력한 세션은 기존 세션과 시간이 겹치지 않도록 거부합니다.
- 주간 리포트는 일요일을 한 주의 시작으로 사용합니다.
- 세션 편집 시 변경하지 않은 시간 필드는 원본의 초·소수점 정밀도를 보존합니다. 직접 변경한 시간 필드만 분 단위로 저장합니다.
- 오늘의 수동 세션 기본값은 현재 분까지의 지난 1시간이며, 기존 세션과 겹치면 저장이 거부됩니다.

## 코드 검토 기록

[2026-09-08 검토 및 수정 기록](docs/code-review-2026-09-08.md)에 발견 사항, 수정 방향과 검증 결과를 정리했습니다.

## 운영

- SQLite는 WAL 모드와 5초 쓰기 대기 시간을 사용합니다.
- 실행 중 백업할 때는 단순 파일 복사보다 SQLite 온라인 백업 기능을 사용해야 합니다.
- 백업 파일은 애플리케이션의 `data` 볼륨과 다른 저장소에 보관하는 것을 권장합니다.

## 운영 결정 사항

- 외부 인증은 Cloudflare Access가 담당하며 애플리케이션 로그인/PIN은 사용하지 않습니다.
- 데이터 모델: 프로젝트/폴더, 태그, 메모, 수동 시간 수정, 휴지통 복구 여부를 정하면 리포트가 좋아집니다.
- 백업: SQLite 파일을 주기적으로 백업할 위치와 보관 기간을 정하는 것이 좋습니다.
- 배포 운영: Cloudflare Tunnel 서비스명, 도메인, systemd/docker compose 자동 재시작 정책을 서버에서 확정하면 됩니다.
