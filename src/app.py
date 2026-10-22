from __future__ import annotations

import copy
import os
import tempfile
import tkinter as tk
import tkinter.font as tkfont
from tkinter import filedialog, messagebox, simpledialog, ttk

try:
    from . import model
except ImportError:
    import model

CELL_W, CELL_H, HEAD_H, ROW_H = 104, 34, 30, 34
PALETTE = ["#fff1a8", "#d9f2dd", "#dceaff", "#f8dce4"]
TOOLS = [("选择", "select"), ("表格", "table"), ("文字", "text"), ("直线", "line"), ("箭头", "arrow"), ("矩形", "rect"), ("椭圆", "ellipse"), ("画笔", "pen")]


class ThinkingCanvas:
    def __init__(self, root):
        self.root = root
        self.root.title("思考画布 | Thinking Canvas")
        self.root.geometry("1450x900"); self.root.minsize(1100, 700)
        self.project = model.fresh_project(); self.path = None; self.dirty = False
        self.history = [copy.deepcopy(self.project)]; self.hist_i = 0
        self.cell_font=tkfont.Font(self.root,font=("Segoe UI",9))
        self.title_font=tkfont.Font(self.root,font=("Segoe UI",10,"bold"))
        self.tool = "select"; self.selected = None; self.cell = None; self.selection=None; self.drag = None; self.temp = None; self.edit = None
        self._ui(); self.redraw(); self._bind()

    def _ui(self):
        self.root.configure(bg="#f4f6f8")
        bar = tk.Frame(self.root, bg="#ffffff", height=44); bar.pack(fill="x", side="top")
        for label, command in [("新建", self.new_file), ("打开", self.open_file), ("保存", self.save_file), ("撤销", self.undo), ("重做", self.redo)]:
            tk.Button(bar, text=label, command=command, relief="flat", bg="white", padx=12).pack(side="left", pady=6)
        tk.Frame(bar, bg="#e4e8ed", width=1, height=25).pack(side="left", padx=4)
        tk.Button(bar, text="＋ 数据表格", command=self.insert_table, relief="flat", bg="#eaf2ff", padx=12).pack(side="left", padx=4)
        tk.Button(bar, text="复制表格  Ctrl+D", command=self.duplicate, relief="flat", bg="white", padx=10).pack(side="left", padx=4)
        tk.Button(bar, text="＋行", command=lambda:self.extend_table("row"), relief="flat", bg="white", padx=8).pack(side="left", padx=2)
        tk.Button(bar, text="＋列", command=lambda:self.extend_table("col"), relief="flat", bg="white", padx=8).pack(side="left", padx=2)
        self.toolbar = tk.Frame(self.root, bg="#f4f6f8", height=42); self.toolbar.pack(fill="x", side="top")
        self.tool_buttons = {}
        for label, key in TOOLS:
            b = tk.Button(self.toolbar, text=label, command=lambda k=key: self.set_tool(k), relief="flat", padx=10, bg="#f4f6f8")
            b.pack(side="left", padx=2, pady=4); self.tool_buttons[key] = b
        tk.Label(self.toolbar, text="颜色", bg="#f4f6f8", fg="#606c78").pack(side="left", padx=(16,5))
        for color in PALETTE:
            tk.Button(self.toolbar, bg=color, width=2, relief="solid", command=lambda c=color: self.color_cells(c)).pack(side="left", padx=3)
        host = tk.Frame(self.root, bg="#f4f6f8"); host.pack(fill="both", expand=True, padx=10, pady=(0,8))
        self.canvas = tk.Canvas(host, bg="#fbfcfd", highlightthickness=1, highlightbackground="#dce2e8", xscrollincrement=24, yscrollincrement=24)
        self.hbar = ttk.Scrollbar(host, orient="horizontal", command=self.canvas.xview); self.vbar = ttk.Scrollbar(host, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(xscrollcommand=self.hbar.set, yscrollcommand=self.vbar.set)
        self.canvas.grid(row=0,column=0,sticky="nsew"); self.vbar.grid(row=0,column=1,sticky="ns"); self.hbar.grid(row=1,column=0,sticky="ew")
        host.rowconfigure(0,weight=1); host.columnconfigure(0,weight=1)
        self.status = tk.StringVar(value="选择工具：点击对象并拖动；双击单元格可编辑。")
        tk.Label(self.root,textvariable=self.status,anchor="w",bg="#eef1f4",fg="#59636e",padx=12,pady=5).pack(fill="x",side="bottom")

    def _bind(self):
        c=self.canvas
        c.bind("<Button-1>", self.down); c.bind("<B1-Motion>", self.motion); c.bind("<ButtonRelease-1>", self.up)
        c.bind("<Double-Button-1>", self.double_click); c.bind("<Button-2>", self.pan_start); c.bind("<B2-Motion>", self.pan_move)
        c.bind("<MouseWheel>", lambda e: c.yview_scroll(-1 if e.delta>0 else 1,"units"))
        self.root.bind("<Control-z>",lambda e:self.key_action(e,self.undo)); self.root.bind("<Control-y>",lambda e:self.key_action(e,self.redo))
        self.root.bind("<Control-s>",lambda e:self.save_file()); self.root.bind("<Control-o>",lambda e:self.open_file())
        self.root.bind("<Control-n>",lambda e:self.new_file()); self.root.bind("<Control-d>",lambda e:self.key_action(e,self.duplicate))
        self.root.bind("<Control-c>",lambda e:self.key_action(e,self.copy_cells)); self.root.bind("<Control-v>",lambda e:self.key_action(e,self.paste_cells))
        self.root.bind("<Delete>",lambda e:self.key_action(e,self.delete_selected)); self.root.bind("<Return>",lambda e:self.key_action(e,self.begin_edit))
        self.root.bind("<Escape>",lambda e:self.cancel_edit())

    def key_action(self,event,action):
        if isinstance(self.root.focus_get(),(tk.Entry,tk.Text)):return None
        action();return "break"

    def set_tool(self, key):
        if self.edit:self.finish_edit(True)
        self.tool=key
        for k,b in self.tool_buttons.items(): b.configure(bg="#dceaff" if k==key else "#f4f6f8")
        hints={"select":"选择工具：点击对象并拖动；拖动单元格可框选，Enter编辑。","table":"表格工具：点击画布插入2行×4列表格。","text":"文字工具：点击画布输入一段文字。","line":"直线工具：拖动绘制；端点可吸附到表格或图形。","arrow":"箭头工具：拖动绘制；端点可吸附到表格或图形。","rect":"矩形工具：拖动绘制。","ellipse":"椭圆工具：拖动绘制。","pen":"画笔工具：按住拖动自由绘制。"}
        self.status.set(hints[key])

    def commit(self):
        self.history=self.history[:self.hist_i+1]; self.history.append(copy.deepcopy(self.project)); self.hist_i+=1; self.dirty=True; self.redraw()
    def undo(self):
        if self.edit: self.finish_edit(True)
        if self.hist_i>0: self.hist_i-=1; self.project=copy.deepcopy(self.history[self.hist_i]); self.dirty=True; self.selected=None; self.cell=None;self.selection=None;self.redraw()
    def redo(self):
        if self.edit:self.finish_edit(True)
        if self.hist_i+1<len(self.history): self.hist_i+=1; self.project=copy.deepcopy(self.history[self.hist_i]); self.dirty=True; self.selected=None;self.cell=None;self.selection=None;self.redraw()

    def ask_save(self):
        if self.edit:self.finish_edit(True)
        if not self.dirty: return True
        answer=messagebox.askyesnocancel("未保存的更改","要保存当前画布吗？",parent=self.root)
        if answer is None:return False
        if answer:return self.save_file()
        return True
    def new_file(self):
        if not self.ask_save():return
        self.project=model.fresh_project();self.path=None;self.dirty=False;self.history=[copy.deepcopy(self.project)];self.hist_i=0;self.selected=None;self.cell=None;self.selection=None;self.redraw()
    def open_file(self):
        if not self.ask_save():return
        path=filedialog.askopenfilename(filetypes=[("思考画布项目","*.json"),("所有文件","*.*")])
        if not path:return
        try: project=model.load_project(path)
        except Exception as e: messagebox.showerror("无法打开",f"文件未加载，画布保持不变。\n{e}",parent=self.root);return
        self.project=project;self.path=path;self.dirty=False;self.history=[copy.deepcopy(project)];self.hist_i=0;self.selected=None;self.cell=None;self.selection=None;self.redraw()
    def save_file(self):
        if self.edit:self.finish_edit(True)
        path=self.path or filedialog.asksaveasfilename(defaultextension=".json",filetypes=[("思考画布项目","*.json")])
        if not path:return False
        try:model.save_project(path,self.project)
        except Exception as e:messagebox.showerror("保存失败",str(e),parent=self.root);return False
        self.path=path;self.dirty=False;self.status.set("已保存："+path);return True

    def insert_table(self,at=None):
        if self.edit:self.finish_edit(True)
        dialog=tk.Toplevel(self.root);dialog.title("插入数据表格");dialog.transient(self.root);dialog.resizable(False,False)
        fields=[]
        for label,value in (("名称","数据表格"),("行数","2"),("列数","4")):
            row=tk.Frame(dialog);row.pack(fill="x",padx=12,pady=5);tk.Label(row,text=label,width=8,anchor="w").pack(side="left")
            entry=tk.Entry(row,width=22);entry.insert(0,value);entry.pack(side="left");fields.append(entry)
        result=[]
        def accept():
            try:
                rows=int(fields[1].get());cols=int(fields[2].get())
                if not (1<=rows<=model.MAX_ROWS and 1<=cols<=model.MAX_COLS):raise ValueError
                result.extend((fields[0].get(),rows,cols));dialog.destroy()
            except ValueError:messagebox.showwarning("表格尺寸","行数1–200，列数1–100。",parent=dialog)
        buttons=tk.Frame(dialog);buttons.pack(fill="x",padx=12,pady=8);tk.Button(buttons,text="取消",command=dialog.destroy).pack(side="right");tk.Button(buttons,text="插入",command=accept).pack(side="right",padx=5)
        dialog.bind("<Return>",lambda e:accept());dialog.grab_set();fields[0].focus_set();self.root.wait_window(dialog)
        if not result:return
        name,rows,cols=result
        x,y=at if at else (self.canvas.canvasx(120),self.canvas.canvasy(100))
        t=model.make_table(name,rows,cols,x,y);self.project["objects"].append(t);self.selected=t["id"];self.cell=(t["id"],0,0);self.selection=None;self.commit()

    def duplicate(self):
        if self.edit:self.finish_edit(True)
        obj=self.obj(self.selected)
        if not obj or obj["kind"]!="table":self.status.set("先选择一个数据表格，再使用复制表格。");return
        dup=model.clone_object(obj);self.project["objects"].append(dup);self.selected=dup["id"];self.cell=(dup["id"],0,0);self.selection=None;self.commit()

    def obj(self, oid):return next((o for o in self.project["objects"] if o["id"]==oid),None)
    def table_box(self,o):return (o["x"],o["y"],o["x"]+CELL_W*len(o["data"][0]),o["y"]+HEAD_H+ROW_H*len(o["data"]))
    def shape_box(self,o):return (o.get("x",0),o.get("y",0),o.get("x",0)+o.get("w",120),o.get("y",0)+o.get("h",70))

    def redraw(self):
        c=self.canvas;c.delete("all")
        # Lightweight graph paper keeps redraws responsive while dragging.
        for x in range(-480,5001,48):c.create_line(x,-480,x,3000,fill="#eef1f4")
        for y in range(-480,3001,48):c.create_line(-480,y,5000,y,fill="#eef1f4")
        for o in self.project["objects"]:
            k=o["kind"]
            if k=="table":self.draw_table(o)
            elif k in {"text","rect","ellipse"}:self.draw_shape(o)
            elif k in {"line","arrow"}:
                a=self.anchor_point(o["start"]);b=self.anchor_point(o["end"])
                if a and b:c.create_line(*a,*b,fill="#49627a",width=4 if self.selected==o["id"] else 2,arrow="last" if k=="arrow" else "none",tags=("obj:"+o["id"],))
            elif k=="pen":c.create_line(*[v for p in o["points"] for v in p],fill="#364b60",width=2,smooth=True,tags=("obj:"+o["id"],))
        minx,miny,maxx,maxy=0,0,1400,900
        for o in self.project["objects"]:
            if o["kind"]=="table":x1,y1,x2,y2=self.table_box(o)
            elif o["kind"] in {"rect","ellipse"}:x1,y1,x2,y2=self.shape_box(o)
            elif o["kind"]=="text":x1,y1,x2,y2=o["x"],o["y"],o["x"]+260,o["y"]+50
            elif o["kind"]=="pen":x1=min(p[0] for p in o["points"]);x2=max(p[0] for p in o["points"]);y1=min(p[1] for p in o["points"]);y2=max(p[1] for p in o["points"])
            else:continue
            minx=min(minx,x1-160);miny=min(miny,y1-160);maxx=max(maxx,x2+160);maxy=max(maxy,y2+160)
        for o in self.project["objects"]:
            if o["kind"] in {"line","arrow"}:
                for key in ("start","end"):
                    point=self.anchor_point(o[key])
                    if point:minx=min(minx,point[0]-160);miny=min(miny,point[1]-160);maxx=max(maxx,point[0]+160);maxy=max(maxy,point[1]+160)
        c.configure(scrollregion=(minx,miny,maxx,maxy))

    def draw_table(self,o):
        c=self.canvas;x=o["x"];y=o["y"];n=len(o["data"][0]); tag="obj:"+o["id"]
        c.create_rectangle(x,y,x+n*CELL_W,y+HEAD_H,fill="#eaf0f5",outline="#8795a2",tags=(tag,"title:"+o["id"]))
        title_width=max(20,n*CELL_W-76)
        title=str(o["name"])
        while title and self.title_font.measure(title)>title_width:title=title[:-1]
        if len(title)<len(o["name"]):title=(title[:-1]+"…") if title else "…"
        c.create_text(x+9,y+HEAD_H/2,text=title,anchor="w",font=self.title_font,fill="#283746",tags=(tag,"title:"+o["id"]))
        c.create_text(x+n*CELL_W-8,y+HEAD_H/2,text=f"{len(o['data'])}×{n}",anchor="e",font=("Segoe UI",9),fill="#596979",tags=(tag,"title:"+o["id"]))
        for r,row in enumerate(o["data"]):
            for col,val in enumerate(row):
                x1=x+col*CELL_W;y1=y+HEAD_H+r*ROW_H;x2=x1+CELL_W;y2=y1+ROW_H
                fill=o["colors"][r][col] or "#ffffff"
                if self.cell and self.cell[0]==o["id"] and self.cell[1]==r and self.cell[2]==col:fill="#d8eaff"
                bounds=getattr(self,"selection",None)
                if bounds and bounds[0]==o["id"] and bounds[1]<=r<=bounds[3] and bounds[2]<=col<=bounds[4]:fill="#d8eaff"
                c.create_rectangle(x1,y1,x2,y2,fill=fill,outline="#c9d2db",tags=(tag,f"cell:{o['id']}:{r}:{col}"))
                c.create_text(x1+5,y1+ROW_H/2,text=f"{r},{col}",anchor="w",font=("Segoe UI",8),fill="#9aa5af",tags=(tag,))
                text=str(val)
                while text and self.cell_font.measure(text)>CELL_W-45:text=text[:-1]
                if len(text)<len(str(val)):text=text[:-1]+"…" if text else "…"
                c.create_text(x1+39,y1+ROW_H/2,text=text,anchor="w",font=("Segoe UI",9),fill="#243341",tags=(tag,))
        if self.selected==o["id"]:
            x1,y1,x2,y2=self.table_box(o);c.create_rectangle(x1-2,y1-2,x2+2,y2+2,outline="#4385d1",width=2,dash=(4,2))

    def draw_shape(self,o):
        c=self.canvas;k=o["kind"];tag="obj:"+o["id"]
        if k=="text":c.create_text(o["x"],o["y"],text=o.get("text",""),anchor="nw",width=260,font=("Segoe UI",11),fill="#293b4b",tags=(tag,))
        else:
            x1,y1,x2,y2=self.shape_box(o);fn=c.create_rectangle if k=="rect" else c.create_oval
            fn(x1,y1,x2,y2,fill="#f5f8fb",outline="#61798d",width=2,tags=(tag,))
            if o.get("text"):c.create_text((x1+x2)/2,(y1+y2)/2,text=o["text"],fill="#344b5e",tags=(tag,))
        if self.selected==o["id"]:
            if k=="text":x1,y1,x2,y2=o["x"],o["y"],o["x"]+260,o["y"]+36
            else:x1,y1,x2,y2=self.shape_box(o)
            c.create_rectangle(x1-3,y1-3,x2+3,y2+3,outline="#4385d1",dash=(4,2))

    def anchor_point(self,p):
        try:return model.anchor_point(self.project,p)
        except ValueError:return None

    def hit(self,x,y):
        for o in reversed(self.project["objects"]):
            if o["kind"] in {"line","arrow"}:
                a=self.anchor_point(o["start"]);b=self.anchor_point(o["end"])
                if a and b:
                    dx=b[0]-a[0];dy=b[1]-a[1];den=dx*dx+dy*dy
                    t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/den)) if den else 0
                    if ((x-(a[0]+t*dx))**2+(y-(a[1]+t*dy))**2)**.5<=9:return o,"shape",None
            if o["kind"]=="table":
                x1,y1,x2,y2=self.table_box(o)
                if x1<=x<=x2 and y1<=y<=y2:
                    if y>=y1+HEAD_H:
                        row=min(len(o["data"])-1,int((y-y1-HEAD_H)//ROW_H));col=min(len(o["data"][0])-1,int((x-x1)//CELL_W))
                        return o,"cell",(row,col)
                    return o,"title",None
            elif o["kind"] in {"rect","ellipse"}:
                x1,y1,x2,y2=self.shape_box(o)
                if x1<=x<=x2 and y1<=y<=y2:return o,"shape",None
            elif o["kind"]=="text" and o["x"]<=x<=o["x"]+260 and o["y"]<=y<=o["y"]+36:return o,"shape",None
            elif o["kind"]=="pen":
                pts=o["points"]
                if min(p[0] for p in pts)-5<=x<=max(p[0] for p in pts)+5 and min(p[1] for p in pts)-5<=y<=max(p[1] for p in pts)+5:return o,"shape",None
        return None,None,None

    def down(self,e):
        if self.edit:self.finish_edit(True)
        x,y=self.canvas.canvasx(e.x),self.canvas.canvasy(e.y);self.drag={"x":x,"y":y,"lastx":x,"lasty":y,"moved":False,"points":[[x,y]]}
        if self.tool=="table":self.insert_table((x,y));self.drag=None;return
        if self.tool=="text":
            text=simpledialog.askstring("添加文字","输入短文：",parent=self.root)
            if text is not None:self.project["objects"].append({"id":model.new_id(),"kind":"text","x":x,"y":y,"text":text});self.commit()
            self.set_tool("select");self.drag=None;return
        if self.tool in {"line","arrow","rect","ellipse","pen"}:self.temp=self.canvas.create_line(x,y,x,y,fill="#52718c",width=2,dash=(3,2));return
        o,part,cell=self.hit(x,y)
        self.selection=None
        if o:
            self.selected=o["id"]
            if part=="cell":self.cell=(o["id"],cell[0],cell[1]);self.selection=(o["id"],cell[0],cell[1],cell[0],cell[1])
            else:self.cell=None
            if part in {"title","shape"} and o["kind"] in {"line","arrow"} and any("object" in o[k] for k in ("start","end")):
                self.status.set("这条线绑定了对象，拖动对应对象即可移动线端；删除后可重新绘制。")
            elif part in {"title","shape"}:
                self.drag.update({"moveid":o["id"],"ox":o.get("x",0),"oy":o.get("y",0)})
        else:self.selected=None;self.cell=None
        self.redraw()

    def motion(self,e):
        if not self.drag:return
        x,y=self.canvas.canvasx(e.x),self.canvas.canvasy(e.y);d=self.drag
        if abs(x-d["x"])+abs(y-d["y"])>3:d["moved"]=True
        if self.tool in {"line","arrow","rect","ellipse"} and self.temp:self.canvas.coords(self.temp,d["x"],d["y"],x,y)
        elif self.tool=="pen" and self.temp:
            d["points"].append([x,y]);self.canvas.coords(self.temp,*[v for p in d["points"] for v in p])
        elif self.tool=="select" and d.get("moveid") and d["moved"]:
            o=self.obj(d["moveid"]);dx=x-d["lastx"];dy=y-d["lasty"]
            model.move_object(o,dx,dy)
            d["lastx"]=x;d["lasty"]=y;self.redraw()

    def up(self,e):
        if not self.drag:return
        d=self.drag;x,y=self.canvas.canvasx(e.x),self.canvas.canvasy(e.y)
        if self.temp:
            try:self.canvas.delete(self.temp)
            except tk.TclError:pass
            self.temp=None
            if self.tool in {"rect","ellipse"}:
                self.project["objects"].append({"id":model.new_id(),"kind":self.tool,"x":min(d["x"],x),"y":min(d["y"],y),"w":max(30,abs(x-d["x"])),"h":max(24,abs(y-d["y"]))})
            elif self.tool in {"line","arrow"}:
                self.project["objects"].append({"id":model.new_id(),"kind":self.tool,"start":self.make_anchor(d["x"],d["y"]),"end":self.make_anchor(x,y)})
            elif self.tool=="pen" and len(d["points"])>1:self.project["objects"].append({"id":model.new_id(),"kind":"pen","points":d["points"]})
            if self.project["objects"]:self.commit()
        elif self.tool=="select" and d.get("moveid") and d["moved"]:self.commit()
        elif self.tool=="select" and d["moved"] and self.selected and self.cell:
            o=self.obj(self.cell[0]);end=self.hit(x,y)
            if o and end[0] and end[0]["id"]==o["id"] and end[2]:self.select_range((self.cell[0],*self.cell[1:]),end[2])
        self.drag=None;self.redraw()

    def make_anchor(self,x,y):
        o,part,cell=self.hit(x,y)
        if o:
            if o["kind"]=="table" and cell:return {"object":o["id"],"row":cell[0],"col":cell[1]}
            if o["kind"] in {"table","text","rect","ellipse"}:return {"object":o["id"]}
        return {"x":x,"y":y}

    def select_range(self,start,end):
        oid,r,c=start;r2,c2=end
        # selection represented as bounds; cell remains its anchor
        self.selection=(oid,min(r,r2),min(c,c2),max(r,r2),max(c,c2));self.redraw()
    def double_click(self,e):
        x,y=self.canvas.canvasx(e.x),self.canvas.canvasy(e.y);o,part,cell=self.hit(x,y)
        if o and part=="cell":self.selected=o["id"];self.cell=(o["id"],cell[0],cell[1]);self.begin_edit()
        elif o and part=="title":
            name=simpledialog.askstring("重命名表格","名称：",initialvalue=o["name"],parent=self.root)
            if name is not None:o["name"]=name;self.commit()
        elif o and o["kind"] in {"text","rect","ellipse"}:
            value=simpledialog.askstring("编辑文字","内容：",initialvalue=o.get("text",""),parent=self.root)
            if value is not None:o["text"]=value;self.commit()

    def begin_edit(self):
        if not self.cell:return
        o=self.obj(self.cell[0]);r,c=self.cell[1:]
        if not o:return
        x=o["x"]+c*CELL_W+38;y=o["y"]+HEAD_H+r*ROW_H+2
        entry=tk.Entry(self.canvas,font=("Segoe UI",10),bd=1);entry.insert(0,o["data"][r][c]);self.edit=(entry,o["id"],r,c,o["data"][r][c])
        self.canvas.create_window(x,y,window=entry,width=CELL_W-41,height=ROW_H-4,anchor="nw",tags="cell-editor")
        entry.focus_set();entry.bind("<Return>",lambda e:(self.finish_edit(True),"break")[1]);entry.bind("<Tab>",lambda e:(self.finish_edit(True,True),"break")[1]);entry.bind("<Escape>",lambda e:(self.cancel_edit(),"break")[1])
    def finish_edit(self,save=True,next_cell=False):
        if not self.edit:return
        entry,oid,r,c,old=self.edit;value=entry.get() if save else old
        try:entry.destroy()
        except tk.TclError:pass
        self.edit=None;o=self.obj(oid)
        if save and o and o["data"][r][c]!=value:o["data"][r][c]=value;self.commit()
        else:self.redraw()
        if next_cell and o:
            if c+1<len(o["data"][0]):self.cell=(oid,r,c+1)
            elif r+1<len(o["data"]):self.cell=(oid,r+1,0)
            self.redraw();self.begin_edit()
    def cancel_edit(self):
        if self.edit:self.finish_edit(False)

    def selected_bounds(self):
        if not self.cell:return None
        return self.selection or (self.cell[0],self.cell[1],self.cell[2],self.cell[1],self.cell[2])
    def copy_cells(self):
        b=self.selected_bounds()
        if not b:return
        oid,r1,c1,r2,c2=b;o=self.obj(oid)
        text="\n".join("\t".join(o["data"][r][c1:c2+1]) for r in range(r1,r2+1))
        self.root.clipboard_clear();self.root.clipboard_append(text)
    def paste_cells(self):
        try:text=self.root.clipboard_get()
        except tk.TclError:return
        rows=[line.split("\t") for line in text.splitlines()]
        if not rows:return
        if not self.cell:
            try:t=model.make_table("粘贴的数据",len(rows),max(map(len,rows)),self.canvas.canvasx(140),self.canvas.canvasy(120))
            except ValueError as e:messagebox.showwarning("粘贴范围过大",str(e),parent=self.root);return
            self.project["objects"].append(t);self.cell=(t["id"],0,0);self.selected=t["id"]
        o=self.obj(self.cell[0]);r0,c0=self.cell[1:]
        if not o:return
        try:model.paste_values(o,rows,r0,c0)
        except ValueError as e:messagebox.showwarning("粘贴范围过大",str(e),parent=self.root);return
        self.selection=(o["id"],r0,c0,r0+len(rows)-1,c0+max(map(len,rows))-1);self.commit()
    def color_cells(self,color):
        if self.edit:self.finish_edit(True)
        b=self.selected_bounds()
        if not b:return
        oid,r1,c1,r2,c2=b;o=self.obj(oid)
        for r in range(r1,r2+1):
            for c in range(c1,c2+1):o["colors"][r][c]=color
        self.commit()

    def extend_table(self,axis):
        if self.edit:self.finish_edit(True)
        o=self.obj(self.selected)
        if not o or o["kind"]!="table":self.status.set("先选择一个数据表格。");return
        if axis=="row":
            if len(o["data"])>=model.MAX_ROWS:return
            o["data"].append([""]*len(o["data"][0]));o["colors"].append([""]*len(o["data"][0]))
        else:
            if len(o["data"][0])>=model.MAX_COLS:return
            for r in o["data"]:r.append("")
            for r in o["colors"]:r.append("")
        self.commit()
    def delete_selected(self):
        if self.edit:return
        b=self.selected_bounds()
        if b:
            oid,r1,c1,r2,c2=b;o=self.obj(oid)
            for r in range(r1,r2+1):
                for c in range(c1,c2+1):o["data"][r][c]=""
            self.commit();return
        if not self.selected:return
        oid=self.selected;self.project["objects"]=[o for o in self.project["objects"] if o["id"]!=oid and not (o["kind"] in {"line","arrow"} and any(isinstance(o.get(k),dict) and o[k].get("object")==oid for k in ("start","end")))];self.selected=None;self.commit()
    def pan_start(self,e):self.canvas.scan_mark(e.x,e.y)
    def pan_move(self,e):self.canvas.scan_dragto(e.x,e.y,gain=1)


def run_smoke():
    root=tk.Tk();app=ThinkingCanvas(root);root.update_idletasks()
    assert app.project==model.fresh_project()
    def accept_table():
        for w in root.winfo_children():
            if isinstance(w,tk.Toplevel) and w.title()=="插入数据表格":
                entries=[q for q in w.winfo_children() if isinstance(q,tk.Frame)]
                fields=[q for row in entries for q in row.winfo_children() if isinstance(q,tk.Entry)]
                for field,value in zip(fields,("Smoke","2","4")):field.delete(0,"end");field.insert(0,value)
                for row in entries:
                    for q in row.winfo_children():
                        if isinstance(q,tk.Button) and q.cget("text")=="插入":q.invoke()
    root.after(50,accept_table);app.insert_table((120,100));root.update()
    table=app.project["objects"][0];app.cell=(table["id"],0,0);app.begin_edit();app.edit[0].insert(0,"ok");app.edit[0].focus_force();root.update();app.edit[0].event_generate("<Return>");root.update()
    assert app.edit is None and app.obj(table["id"])["data"][0][0]=="ok"
    app.duplicate();duplicate=app.obj(app.selected);assert duplicate["data"] is not table["data"]
    app.undo();assert len(app.project["objects"])==1
    app.redo();assert len(app.project["objects"])==2
    duplicate=app.project["objects"][1];duplicate["data"][0][0]="copy only";assert table["data"][0][0]=="ok"
    app.undo();app.redo()
    app.set_tool("rect");app.canvas.event_generate("<Button-1>",x=500,y=100);app.canvas.event_generate("<B1-Motion>",x=570,y=150);app.canvas.event_generate("<ButtonRelease-1>",x=570,y=150);root.update()
    assert app.hit(470,132)[0]["id"]==table["id"]
    app.set_tool("arrow");app.canvas.event_generate("<Button-1>",x=470,y=132);app.canvas.event_generate("<B1-Motion>",x=600,y=230);app.canvas.event_generate("<ButtonRelease-1>",x=600,y=230);root.update()
    assert sum(o["kind"]=="rect" for o in app.project["objects"])==1
    assert sum(o["kind"]=="arrow" for o in app.project["objects"])==1
    arrow=next(o for o in app.project["objects"] if o["kind"]=="arrow")
    assert arrow["start"].get("object")==table["id"]
    app.undo();assert sum(o["kind"]=="arrow" for o in app.project["objects"])==0
    app.redo();app.selected=table["id"];app.cell=(table["id"],0,0);app.selection=(table["id"],0,0,0,0)
    app.set_tool("select")
    app.down(type("Event",(),{"x":130,"y":105})());app.up(type("Event",(),{"x":130,"y":105})())
    assert app.cell is None
    app.delete_selected();assert app.obj(table["id"]) is None
    assert not any(o["kind"]=="arrow" for o in app.project["objects"])
    app.undo();assert app.obj(table["id"]) is not None
    with tempfile.TemporaryDirectory() as folder:
        app.path=os.path.join(folder,"smoke.json");assert app.save_file();assert model.load_project(app.path)==app.project
    root.destroy()


def run_capture(path):
    root=tk.Tk();app=ThinkingCanvas(root)
    table=model.make_table("输入数据",3,4,125,135)
    table["data"]=[["温度","18","21","24"],["步数","0","1","2"],["输出","A","B","C"]]
    after=model.clone_object(table,480,110);after["name"]="对照结果";after["data"][1]=["步数","1","2","3"]
    app.project["objects"]=[table,after,
        {"id":model.new_id(),"kind":"text","x":140,"y":95,"text":"输入序列"},
        {"id":model.new_id(),"kind":"text","x":625,"y":95,"text":"变换后"},
        {"id":model.new_id(),"kind":"arrow","start":{"object":table["id"],"row":2,"col":3},"end":{"object":after["id"],"row":2,"col":0}},
        {"id":model.new_id(),"kind":"ellipse","x":545,"y":500,"w":80,"h":54,"text":"处理"}]
    app.selected=after["id"];app.cell=(after["id"],1,2);app.redraw();root.update()
    try:
        from PIL import ImageGrab
        x=root.winfo_rootx();y=root.winfo_rooty();w=root.winfo_width();h=root.winfo_height()
        ImageGrab.grab(bbox=(x,y,x+w,y+h)).save(path)
    finally:root.destroy()


def main():
    import sys
    if "--smoke" in sys.argv:run_smoke();return
    if "--capture" in sys.argv:
        run_capture(sys.argv[sys.argv.index("--capture")+1]);return
    root=tk.Tk();app=ThinkingCanvas(root)
    def close():
        if app.ask_save():root.destroy()
    root.protocol("WM_DELETE_WINDOW",close);root.mainloop()


if __name__=="__main__":main()
