from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, StringConstraints, field_validator

from app import repository

APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
TaskName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


@asynccontextmanager
async def lifespan(_: FastAPI):
    repository.init_db()
    yield


app = FastAPI(title="Timetracking Dashboard", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class TaskCreate(BaseModel):
    name: TaskName
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class TaskUpdate(BaseModel):
    name: TaskName | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    archived: bool | None = None
    notes: str | None = Field(default=None, max_length=2000)


class TaskReorder(BaseModel):
    task_ids: list[int]


class SessionUpdate(BaseModel):
    task_id: int
    started_at: datetime
    ended_at: datetime | None = None
    notes: str = Field(default="", max_length=2000)

    @field_validator("started_at", "ended_at")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("datetime values must include a timezone")
        return value


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/tasks")
def tasks(include_archived: bool = False) -> list[dict]:
    return repository.list_tasks(include_archived)


@app.post("/api/tasks", status_code=201)
def create_task(payload: TaskCreate) -> dict:
    return repository.create_task(payload.name, payload.color)


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: int, payload: TaskUpdate) -> dict:
    task = repository.update_task(
        task_id,
        payload.name,
        payload.color,
        payload.archived,
        payload.notes,
    )
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/api/tasks/reorder")
def reorder_tasks(payload: TaskReorder) -> list[dict]:
    tasks = repository.reorder_tasks(payload.task_ids)
    if tasks is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return tasks


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int):
    if not repository.delete_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


@app.post("/api/tasks/{task_id}/start", status_code=201)
def start_session(task_id: int) -> dict:
    session = repository.start_session(task_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return session


@app.post("/api/sessions", status_code=201)
def create_session(payload: SessionUpdate) -> dict:
    try:
        session = repository.create_session(
            payload.task_id,
            payload.started_at.isoformat(),
            payload.ended_at.isoformat() if payload.ended_at else None,
            payload.notes,
        )
    except repository.ActiveSessionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if session is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return session


@app.post("/api/sessions/stop")
def stop_session() -> dict:
    session = repository.stop_active_session()
    if session is None:
        raise HTTPException(status_code=404, detail="No active session")
    return session


@app.get("/api/sessions/active")
def active_session() -> dict | None:
    return repository.get_active_session()


@app.get("/api/sessions")
def sessions(start: str | None = None, end: str | None = None) -> list[dict]:
    try:
        return repository.list_sessions(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/api/sessions/{session_id}")
def update_session(session_id: int, payload: SessionUpdate) -> dict:
    try:
        session = repository.update_session(
            session_id,
            payload.task_id,
            payload.started_at.isoformat(),
            payload.ended_at.isoformat() if payload.ended_at else None,
            payload.notes,
        )
    except repository.ActiveSessionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: int) -> Response:
    if not repository.delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return Response(status_code=204)


@app.get("/api/admin/db")
def admin_db() -> dict:
    return repository.list_admin_db()
