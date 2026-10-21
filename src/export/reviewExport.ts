import { sanitizeFilename } from "./migrationPackage";
import type { WorkspaceReview } from "../review/model";

export function downloadWorkspaceReview(review: WorkspaceReview): void {
  const filename = `gtm-migrate-review-${sanitizeFilename(review.source.workspaceName ?? review.source.workspaceId)}.json`;
  const blob = new Blob([`${JSON.stringify(review, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
