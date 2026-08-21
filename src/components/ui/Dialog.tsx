import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./Button";
import i18n from "i18next";

export function Dialog({ open, onOpenChange, title, description, children, footer }: { open: boolean; onOpenChange(open: boolean): void; title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content className="dialog-content">
        <div className="dialog-heading"><div><DialogPrimitive.Title>{title}</DialogPrimitive.Title>{description && <DialogPrimitive.Description>{description}</DialogPrimitive.Description>}</div><DialogPrimitive.Close asChild><IconButton label={i18n.t("common.actions.close")}><X size={18} /></IconButton></DialogPrimitive.Close></div>
        <div className="dialog-body">{children}</div>{footer && <div className="dialog-footer">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
