import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

export function Pager({ page, size, total, onChange }: { page: number; size: number; total: number; onChange: (page: number) => void }) {
  const { t } = useTranslation();
  if (!total) return null;
  return <div className="pager">
    <span>{t("visual.pageRange", { start: page * size + 1, end: Math.min(total, (page + 1) * size), total })}</span>
    <button type="button" aria-label={t("visual.previous")} disabled={page === 0} onClick={() => onChange(page - 1)}><ChevronLeft size={16} /></button>
    <button type="button" aria-label={t("visual.next")} disabled={(page + 1) * size >= total} onClick={() => onChange(page + 1)}><ChevronRight size={16} /></button>
  </div>;
}
