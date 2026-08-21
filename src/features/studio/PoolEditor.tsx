import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Papa from "papaparse";
import { Check, Download, FileInput, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import type { PoolEntry } from "../../domain/types";
import { createId, parseIntegerList } from "../../domain/random";
import { saveLocalFile } from "../../platform/files";
import { useAppStore } from "../../app/store";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";

export default function PoolEditor({ mode = "custom" }: { mode?: "custom" }) {
  void mode;
  const pools = useAppStore((state) => state.pools);
  const updatePools = useAppStore((state) => state.updatePools);
  const setToast = useAppStore((state) => state.setToast);
  const setError = useAppStore((state) => state.setError);

  const source = pools.customEntries;
  const [draft, setDraft] = useState<PoolEntry[]>(() => structuredClone(source));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<PoolEntry[][]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [firstInvalid, setFirstInvalid] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(structuredClone(source));
    setUndo([]);
    setSelected(new Set());
  }, [source]);

  const virtualizer = useVirtualizer({
    count: draft.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 49,
    overscan: 8,
  });

  const duplicateValues = useMemo(() => {
    const counts = new Map<number, number>();
    draft.forEach((entry) => counts.set(entry.value, (counts.get(entry.value) || 0) + 1));
    return new Set([...counts].filter(([, count]) => count > 1).map(([value]) => value));
  }, [draft]);

  const checkpoint = () => setUndo((previous) => [...previous.slice(-19), structuredClone(draft)]);
  const mutate = (next: PoolEntry[]) => {
    checkpoint();
    setDraft(next.slice(0, 500));
  };

  const updateEntry = (id: string, updates: Partial<PoolEntry>) =>
    setDraft((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry))
    );

  const add = () => {
    const used = new Set(draft.map((entry) => entry.value));
    let value = 1;
    while (used.has(value)) value += 1;
    mutate([...draft, { id: createId("custom"), value, tags: [] }]);
    window.setTimeout(() => virtualizer.scrollToIndex(draft.length), 0);
  };

  const removeSelected = () => {
    if (!selected.size) return;
    mutate(draft.filter((entry) => !selected.has(entry.id)));
    setSelected(new Set());
  };

  const undoDraft = () => {
    const previous = undo.at(-1);
    if (!previous) return;
    setDraft(previous);
    setUndo((items) => items.slice(0, -1));
  };

  const validate = () => {
    let index = draft.findIndex(
      (entry) => !Number.isSafeInteger(entry.value) || duplicateValues.has(entry.value)
    );
    if (index < 0 && !draft.length) index = 0;
    setFirstInvalid(index >= 0 ? index : null);
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: "center" });
      setError(index === 0 && !draft.length ? "请至少添加一个数字" : `第 ${index + 1} 行未通过校验`);
      return false;
    }
    return true;
  };

  const save = () => {
    if (!validate()) return;
    updatePools({ customEntries: draft });
    setToast("自定义数字池已保存");
  };

  const parseBulk = (text: string): PoolEntry[] => {
    return parseIntegerList(text).values.map((value) => ({
      id: createId("custom"),
      value,
      tags: [],
    }));
  };

  const applyBulk = () => {
    try {
      const entries = parseBulk(bulkText);
      if (!entries.length) throw new Error("没有识别到有效数字");
      mutate(entries);
      setBulkOpen(false);
      setBulkText("");
      setToast(`已载入 ${entries.length} 行草稿，请校验后保存`);
    } catch (error) {
      setError((error as Error).message);
    }
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      let entries: PoolEntry[];
      if (file.name.toLowerCase().endsWith(".json")) {
        const data = JSON.parse(text);
        entries = data.entries || data.pools?.customEntries || data;
      } else {
        entries = parseBulk(text);
      }
      mutate(
        entries.map((entry) => ({
          ...entry,
          id: entry.id || createId("custom"),
          tags: entry.tags || [],
        }))
      );
      setToast(`已导入 ${entries.length} 行草稿`);
    } catch (error) {
      setError(`导入失败：${(error as Error).message}`);
    }
  };

  const exportData = async () => {
    const csv = `\uFEFF${Papa.unparse(
      draft.map((entry) => ({ 数字: entry.value, 标签: entry.tags.join("|") }))
    )}`;
    await saveLocalFile("掷数台-自定义池.csv", csv, "text/csv");
    setToast("CSV 已导出");
  };

  return (
    <section
      className="pool-editor"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void importFile(event.dataTransfer.files[0]);
      }}
    >
      <div className="editor-toolbar">
        <div>
          <span className="section-label">数字表</span>
          <p>{draft.length}/500 行</p>
        </div>
        <div>
          <Button icon={<FileInput size={15} />} onClick={() => setBulkOpen(true)}>
            批量粘贴
          </Button>
          <Button icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>
            导入
          </Button>
          <Button icon={<Download size={15} />} onClick={() => void exportData()}>
            导出
          </Button>
          <input
            ref={fileRef}
            hidden
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={(event) => {
              void importFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="table-head">
        <span>
          <input
            type="checkbox"
            aria-label="选择全部"
            checked={draft.length > 0 && selected.size === draft.length}
            onChange={(event) =>
              setSelected(event.target.checked ? new Set(draft.map((entry) => entry.id)) : new Set())
            }
          />
        </span>
        <span>数字</span>
        <span>标签</span>
      </div>

      <div className="virtual-table" ref={scrollRef}>
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const entry = draft[item.index];
            const invalid = duplicateValues.has(entry.value) || !Number.isSafeInteger(entry.value);
            return (
              <div
                className={`table-row ${invalid ? "invalid" : ""} ${firstInvalid === item.index ? "focused-invalid" : ""}`}
                key={entry.id}
                style={{
                  position: "absolute",
                  transform: `translateY(${item.start}px)`,
                  height: `${item.size}px`,
                  width: "100%",
                }}
              >
                <span>
                  <input
                    type="checkbox"
                    aria-label={`选择第 ${item.index + 1} 行`}
                    checked={selected.has(entry.id)}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(entry.id);
                        else next.delete(entry.id);
                        return next;
                      })
                    }
                  />
                </span>
                <span>
                  <input
                    aria-label={`第 ${item.index + 1} 行数字`}
                    type="number"
                    value={entry.value}
                    onChange={(event) => updateEntry(entry.id, { value: Number(event.target.value) })}
                  />
                  {duplicateValues.has(entry.value) && <small>重复</small>}
                </span>
                <span>
                  <input
                    aria-label={`第 ${item.index + 1} 行标签`}
                    value={entry.tags.join("|")}
                    onChange={(event) =>
                      updateEntry(entry.id, {
                        tags: event.target.value
                          .split("|")
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="标签以 | 分隔"
                  />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="editor-footer">
        <div>
          <Button icon={<Plus size={15} />} onClick={add} disabled={draft.length >= 500}>
            添加行
          </Button>
          <Button icon={<Trash2 size={15} />} variant="danger" disabled={!selected.size} onClick={removeSelected}>
            删除所选
          </Button>
          <Button icon={<RotateCcw size={15} />} disabled={!undo.length} onClick={undoDraft}>
            撤销编辑
          </Button>
        </div>
        <Button variant="primary" icon={<Check size={16} />} onClick={save}>
          校验并保存
        </Button>
      </div>

      <Dialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="批量载入数字"
        description="支持逗号、空格或换行分隔数字。"
        footer={
          <>
            <Button variant="quiet" onClick={() => setBulkOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={applyBulk}>
              载入草稿
            </Button>
          </>
        }
      >
        <textarea
          className="bulk-textarea"
          autoFocus
          rows={10}
          value={bulkText}
          onChange={(event) => setBulkText(event.target.value)}
          placeholder={"1, 2, 3, 5, 8\n13, 21\n34"}
        />
      </Dialog>
    </section>
  );
}
