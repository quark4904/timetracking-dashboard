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

## 테스트

저장소 테스트는 별도 테스트 라이브러리 없이 실행할 수 있습니다.

```bash
python3 -m unittest
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
- 주간 리포트는 일요일을 한 주의 시작으로 사용합니다.

## 운영

- SQLite는 WAL 모드와 5초 쓰기 대기 시간을 사용합니다.
- 실행 중 백업할 때는 단순 파일 복사보다 SQLite 온라인 백업 기능을 사용해야 합니다.
- 백업 파일은 애플리케이션의 `data` 볼륨과 다른 저장소에 보관하는 것을 권장합니다.

## 추가로 정하면 좋은 것

- 인증: Cloudflare Access를 붙일지, 앱 자체 로그인/PIN을 둘지 결정이 필요합니다.
- 데이터 모델: 프로젝트/폴더, 태그, 메모, 수동 시간 수정, 휴지통 복구 여부를 정하면 리포트가 좋아집니다.
- 백업: SQLite 파일을 주기적으로 백업할 위치와 보관 기간을 정하는 것이 좋습니다.
- 배포 운영: Cloudflare Tunnel 서비스명, 도메인, systemd/docker compose 자동 재시작 정책을 서버에서 확정하면 됩니다.
