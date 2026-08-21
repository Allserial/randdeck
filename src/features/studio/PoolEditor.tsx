import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const locale = useAppStore((state) => state.ui.locale);
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
      setError(index === 0 && !draft.length ? t("errors.needNumber") : t("errors.rowInvalid", { row: index + 1 }));
      return false;
    }
    return true;
  };

  const save = () => {
    if (!validate()) return;
    updatePools({ customEntries: draft });
    setToast(t("common.actions.save"));
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
      if (!entries.length) throw new Error(t("errors.noNumbers"));
      mutate(entries);
      setBulkOpen(false);
      setBulkText("");
      setToast(`${t("studio.loadDraft")} (${entries.length} ${t("common.units.rows")})`);
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
      setToast(`${t("common.actions.import")} (${entries.length} ${t("common.units.rows")})`);
    } catch (error) {
      setError(t("errors.importFailed", { message: (error as Error).message }));
    }
  };

  const exportData = async () => {
    const csv = `\uFEFF${Papa.unparse(
      draft.map((entry) => ({ 数字: entry.value, 标签: entry.tags.join("|") }))
    )}`;
    await saveLocalFile(`${locale === "en-US" ? "RandDeck" : "掷数台"}-custom-pool.csv`, csv, "text/csv");
    setToast(t("common.actions.export"));
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
          <span className="section-label">{t("studio.table")}</span>
          <p>{draft.length}/500 {t("common.units.rows")}</p>
        </div>
        <div>
          <Button icon={<FileInput size={15} />} onClick={() => setBulkOpen(true)}>
            {t("studio.bulkPaste")}
          </Button>
          <Button icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>
            {t("studio.import")}
          </Button>
          <Button icon={<Download size={15} />} onClick={() => void exportData()}>
            {t("studio.export")}
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
            aria-label={t("studio.selectAll")}
            checked={draft.length > 0 && selected.size === draft.length}
            onChange={(event) =>
              setSelected(event.target.checked ? new Set(draft.map((entry) => entry.id)) : new Set())
            }
          />
        </span>
        <span>{t("studio.number")}</span>
        <span>{t("studio.tags")}</span>
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
                    aria-label={`${t("studio.selectAll")} ${item.index + 1}`}
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
                    aria-label={`${t("studio.number")} ${item.index + 1}`}
                    type="number"
                    value={entry.value}
                    onChange={(event) => updateEntry(entry.id, { value: Number(event.target.value) })}
                  />
                  {duplicateValues.has(entry.value) && <small>{t("studio.duplicate")}</small>}
                </span>
                <span>
                  <input
                    aria-label={`${t("studio.tags")} ${item.index + 1}`}
                    value={entry.tags.join("|")}
                    onChange={(event) =>
                      updateEntry(entry.id, {
                        tags: event.target.value
                          .split("|")
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder={t("studio.tagsPlaceholder")}
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
            {t("studio.addRow")}
          </Button>
          <Button icon={<Trash2 size={15} />} variant="danger" disabled={!selected.size} onClick={removeSelected}>
            {t("studio.deleteSelected")}
          </Button>
          <Button icon={<RotateCcw size={15} />} disabled={!undo.length} onClick={undoDraft}>
            {t("studio.undoEdit")}
          </Button>
        </div>
        <Button variant="primary" icon={<Check size={16} />} onClick={save}>
          {t("studio.validateSave")}
        </Button>
      </div>

      <Dialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={t("studio.bulkTitle")}
        description={t("studio.bulkDescription")}
        footer={
          <>
            <Button variant="quiet" onClick={() => setBulkOpen(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button variant="primary" onClick={applyBulk}>
              {t("studio.loadDraft")}
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
