import { cancelCeremony } from "./drawController";
import { beginStoreClose, flushStoreUntilStable } from "./store";

export async function prepareMainWindowClose(): Promise<void> {
  beginStoreClose();
  // Cancel any receipt, animation or countdown that could commit after the
  // closing snapshot. Already committed transactions remain in the save queue.
  cancelCeremony();
  await flushStoreUntilStable();
}
