import copy
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import model


class CanvasModelTests(unittest.TestCase):
    def test_tsv_paste_expands_and_preserves_values(self):
        table = model.make_table(rows=2, cols=2)
        table["data"][0][0] = "keep"
        model.paste_values(table, [["a", "b"], ["c", "d"], ["e", "f"]], 1, 1)
        self.assertEqual((len(table["data"]), len(table["data"][0])), (4, 3))
        self.assertEqual(table["data"][0][0], "keep")
        self.assertEqual([table["data"][r][1:] for r in range(1,4)], [["a","b"],["c","d"],["e","f"]])

    def test_duplicate_has_independent_data(self):
        a=model.make_table();a["data"][0][0]="before";b=model.clone_object(a)
        b["data"][0][0]="after"
        self.assertNotEqual(a["id"],b["id"]);self.assertEqual(a["data"][0][0],"before")

    def test_cell_anchor_tracks_table_move(self):
        table=model.make_table(x=10,y=20);project=model.fresh_project();project["objects"].append(table)
        anchor={"object":table["id"],"row":1,"col":2};before=model.anchor_point(project,anchor)
        model.move_object(table,75,-12);after=model.anchor_point(project,anchor)
        self.assertEqual(after,(before[0]+75,before[1]-12))

    def test_undo_redo_snapshots_are_isolated(self):
        first=model.fresh_project();table=model.make_table();first["objects"].append(table)
        history=[copy.deepcopy(first)];table["data"][0][0]="edited";history.append(copy.deepcopy(first))
        history[0]["objects"][0]["x"]+=33
        self.assertEqual(history[1]["objects"][0]["x"],120)
        self.assertEqual(history[0]["objects"][0]["data"][0][0],"")
        self.assertEqual(history[1]["objects"][0]["data"][0][0],"edited")

    def test_json_roundtrip_and_rejects_bad_anchor(self):
        p=model.fresh_project();t=model.make_table("数组",1,3);p["objects"].append(t)
        p["objects"].append({"id":model.new_id(),"kind":"arrow","start":{"object":t["id"],"row":0,"col":2},"end":{"x":50,"y":60}})
        with tempfile.TemporaryDirectory() as d:
            path=os.path.join(d,"canvas.json");model.save_project(path,p)
            self.assertEqual(model.load_project(path),p)
            bad=copy.deepcopy(p);bad["objects"][1]["start"]["col"]=9
            with open(path,"w",encoding="utf8") as f:json.dump(bad,f)
            with self.assertRaises(ValueError):model.load_project(path)


if __name__=="__main__":unittest.main()
