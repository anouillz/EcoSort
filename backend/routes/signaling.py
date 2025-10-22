from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from starlette.websockets import WebSocketState
from typing import Dict
import asyncio
from collections import defaultdict

router = APIRouter()

rooms: Dict[str, Dict[str, WebSocket]] = {}
locks: Dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

async def send_json_safe(ws: WebSocket | None, obj):
    if ws and ws.client_state == WebSocketState.CONNECTED:
        try:
            await ws.send_json(obj)
        except Exception:
            pass

@router.websocket("/ws/relay/{room_id}")
async def ws_relay(ws: WebSocket, room_id: str, role: str = Query(...)):
    if role not in ("pc", "phone"):
        await ws.close(code=4400)
        return

    await ws.accept()

    # --- register / replace same-role peer ---
    async with locks[room_id]:
        r = rooms.setdefault(room_id, {})
        prev = r.get(role)
        if prev and prev.client_state == WebSocketState.CONNECTED:
            try:
                await prev.close(code=4001)  # replace
            except Exception:
                pass
        r[role] = ws

        # wake PC when both sides present
        if r.get("pc") and r.get("phone"):
            await send_json_safe(r["pc"], {"type": "peer-joined", "role": "phone"})

    other_role = "pc" if role == "phone" else "phone"

    try:
        while True:
            # receive low-level event to detect disconnect without raising
            msg = await ws.receive()
            typ = msg.get("type")

            if typ in ("websocket.disconnect", "websocket.close"):
                break 

            other = rooms.get(room_id, {}).get(other_role)
            if not other or other.client_state != WebSocketState.CONNECTED:
                continue

            if msg.get("text") is not None:
                try:
                    await other.send_text(msg["text"])
                except Exception:
                    pass
            elif msg.get("bytes") is not None:
                try:
                    await other.send_bytes(msg["bytes"])
                except Exception:
                    pass
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        # cleanup
        async with locks[room_id]:
            r = rooms.get(room_id, {})
            if r.get(role) is ws:
                r.pop(role, None)
                if role == "phone" and r.get("pc"):
                    await send_json_safe(r["pc"], {"type": "peer-left", "role": "phone"})
                if not r:
                    rooms.pop(room_id, None)
