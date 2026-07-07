from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import repository

app = FastAPI(title="Timetracking Dashboard")
app.mount("/static", StaticFiles(directory="app/static"), name="static")


class TaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class TaskUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    archived: bool | None = None


class SessionUpdate(BaseModel):
    task_id: int
    started_at: str
    ended_at: str | None = None
    notes: str = Field(default="", max_length=2000)


@app.on_event("startup")
def startup() -> None:
    repository.init_db()


@app.get("/")
def index() -> FileResponse:
    return FileResponse("app/static/index.html")


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
    task = repository.update_task(task_id, payload.name, payload.color, payload.archived)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/api/tasks/{task_id}/start", status_code=201)
def start_session(task_id: int) -> dict:
    session = repository.start_session(task_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return session


@app.post("/api/sessions/stop")
def stop_session() -> dict:
    session = repository.stop_active_session()
    if session is None:
        raise HTTPException(status_code=404, detail="No active session")
    return session


@app.get("/api/sessions")
def sessions() -> list[dict]:
    return repository.list_sessions()


@app.patch("/api/sessions/{session_id}")
def update_session(session_id: int, payload: SessionUpdate) -> dict:
    try:
        session = repository.update_session(
            session_id,
            payload.task_id,
            payload.started_at,
            payload.ended_at,
            payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.delete("/api/sessions/{session_id}", status_code=204)
def delete_session(session_id: int) -> None:
    if not repository.delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")


@app.get("/api/admin/db")
def admin_db() -> dict:
    return repository.list_admin_db()
