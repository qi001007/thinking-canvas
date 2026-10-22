"""Plain data model and persistence for Thinking Canvas."""
from __future__ import annotations

import copy
import json
import math
import os
import re
import tempfile
import uuid

VERSION = 2
MAX_ROWS = 200
MAX_COLS = 100
MAX_COORD = 10_000_000


def new_id():
    return uuid.uuid4().hex


def fresh_project():
    return {"version": VERSION, "objects": []}


def make_table(name="数据表格", rows=2, cols=4, x=120, y=100):
    if not (1 <= rows <= MAX_ROWS and 1 <= cols <= MAX_COLS):
        raise ValueError("行数需为1-200，列数需为1-100")
    return {"id": new_id(), "kind": "table", "name": name or "数据表格", "x": float(x), "y": float(y),
            "data": [["" for _ in range(cols)] for _ in range(rows)],
            "colors": [["" for _ in range(cols)] for _ in range(rows)]}


def _num(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > MAX_COORD:
        raise ValueError(f"{label}必须是有限且合理的数字")


def validate_project(project):
    if not isinstance(project, dict) or project.get("version") != VERSION or not isinstance(project.get("objects"), list):
        raise ValueError("项目格式错误或版本不受支持")
    ids = set()
    for o in project["objects"]:
        if not isinstance(o, dict) or not isinstance(o.get("id"), str) or not o["id"] or o["id"] in ids:
            raise ValueError("对象数据错误：对象ID缺失或重复")
        ids.add(o["id"])
        if not isinstance(o.get("kind"), str) or o["kind"] not in {"table", "text", "rect", "ellipse", "line", "arrow", "pen"}:
            raise ValueError("对象类型不受支持")
        if o["kind"] == "table":
            data=o.get("data")
            if not isinstance(data,list) or not data or not isinstance(data[0],list):raise ValueError("表格尺寸超出范围")
    # Validate targets' table grids before checking anchors, regardless of object order.
    for o in project["objects"]:
        if o["kind"] == "table":
            data=o.get("data")
            if not (1 <= len(data) <= MAX_ROWS) or any(not isinstance(r,list) or not 1 <= len(r) <= MAX_COLS for r in data):raise ValueError("表格尺寸超出范围")
            if any(len(r)!=len(data[0]) or any(not isinstance(v,str) for v in r) for r in data):raise ValueError("表格数据必须为规则的字符串矩阵")
    for o in project["objects"]:
        kind = o.get("kind")
        if kind == "table":
            _num(o.get("x"), "表格坐标"); _num(o.get("y"), "表格坐标")
            data = o.get("data")
            if not isinstance(data, list) or not 1 <= len(data) <= MAX_ROWS or any(not isinstance(r, list) or not 1 <= len(r) <= MAX_COLS for r in data):
                raise ValueError("表格尺寸超出范围")
            width = len(data[0])
            if any(len(r) != width or any(not isinstance(v, str) for v in r) for r in data):
                raise ValueError("表格数据必须为规则的字符串矩阵")
            colors = o.get("colors")
            if not isinstance(colors, list) or len(colors) != len(data) or any(not isinstance(r, list) or len(r) != width or any(not isinstance(c, str) or (c and not re.fullmatch(r"#[0-9a-fA-F]{6}",c)) for c in r) for r in colors):
                raise ValueError("表格颜色数据与表格尺寸不一致")
            if not isinstance(o.get("name"), str): raise ValueError("表格名称格式错误")
        elif kind in {"text", "rect", "ellipse"}:
            for key in ("x", "y"): _num(o.get(key), "对象坐标")
            if kind in {"rect", "ellipse"}:
                for key in ("w", "h"): _num(o.get(key), "图形尺寸")
            if not isinstance(o.get("text", ""), str): raise ValueError("文字格式错误")
        elif kind in {"line", "arrow"}:
            for key in ("start", "end"):
                p = o.get(key)
                if not isinstance(p, dict): raise ValueError("连线端点格式错误")
                if "object" in p:
                    if not isinstance(p["object"], str): raise ValueError("连线锚点对象ID格式错误")
                    if p["object"] not in ids and not any(isinstance(q, dict) and q.get("id") == p["object"] for q in project["objects"]):
                        raise ValueError("连线锚点对象不存在")
                    if "row" in p or "col" in p:
                        target = next(q for q in project["objects"] if q.get("id") == p["object"])
                        if target.get("kind") != "table" or not isinstance(p.get("row"), int) or not isinstance(p.get("col"), int) or not (0 <= p["row"] < len(target["data"]) and 0 <= p["col"] < len(target["data"][0])):
                            raise ValueError("连线单元格锚点越界")
                else:
                    _num(p.get("x"), "连线端点"); _num(p.get("y"), "连线端点")
        elif kind == "pen":
            points = o.get("points")
            if not isinstance(points, list) or len(points) < 2: raise ValueError("画笔路径格式错误")
            for p in points:
                if not isinstance(p, list) or len(p) != 2: raise ValueError("画笔坐标格式错误")
                _num(p[0], "画笔坐标"); _num(p[1], "画笔坐标")
    return copy.deepcopy(project)


def save_project(path, project):
    safe = validate_project(project)
    folder = os.path.dirname(os.path.abspath(path))
    fd, temp = tempfile.mkstemp(prefix=".canvas-", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(safe, f, ensure_ascii=False, indent=2)
            f.flush(); os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp): os.unlink(temp)


def load_project(path):
    with open(path, encoding="utf-8") as f:
        return validate_project(json.load(f))


def clone_object(obj, dx=40, dy=40):
    result = copy.deepcopy(obj)
    old = result["id"]
    result["id"] = new_id()
    if result["kind"] == "table": result["x"] += dx; result["y"] += dy
    elif result["kind"] in {"text", "rect", "ellipse"}: result["x"] += dx; result["y"] += dy
    elif result["kind"] == "pen": result["points"] = [[x+dx, y+dy] for x,y in result["points"]]
    return result


def paste_values(table, rows, start_row, start_col):
    if not rows or not all(isinstance(r, list) for r in rows):
        raise ValueError("粘贴内容必须是表格数据")
    nr = max(len(table["data"]), start_row + len(rows))
    nc = max(len(table["data"][0]), start_col + max(map(len, rows)))
    if nr > MAX_ROWS or nc > MAX_COLS:
        raise ValueError("最多200行、100列")
    for r in table["data"]: r.extend([""] * (nc - len(r)))
    for r in table["colors"]: r.extend([""] * (nc - len(r)))
    while len(table["data"]) < nr:
        table["data"].append([""] * nc); table["colors"].append([""] * nc)
    for i, row in enumerate(rows):
        for j, value in enumerate(row): table["data"][start_row+i][start_col+j] = str(value)


def move_object(obj, dx, dy):
    if obj["kind"] in {"table", "text", "rect", "ellipse"}: obj["x"] += dx; obj["y"] += dy
    elif obj["kind"] == "pen": obj["points"] = [[x+dx, y+dy] for x,y in obj["points"]]
    elif obj["kind"] in {"line", "arrow"}:
        for key in ("start", "end"):
            if "object" not in obj[key]:obj[key]["x"]+=dx;obj[key]["y"]+=dy


def anchor_point(project, anchor):
    if "object" not in anchor: return anchor["x"], anchor["y"]
    obj = next((o for o in project["objects"] if o["id"] == anchor["object"]), None)
    if obj is None: raise ValueError("连线锚点对象不存在")
    if obj["kind"] == "table":
        if "row" in anchor: return obj["x"]+(anchor["col"]+.5)*104, obj["y"]+30+(anchor["row"]+.5)*34
        return obj["x"]+104*len(obj["data"][0])/2, obj["y"]+30+34*len(obj["data"])/2
    return obj.get("x",0), obj.get("y",0)
