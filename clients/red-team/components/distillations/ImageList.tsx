import type { DistillationImageVariant } from "@/lib/distillations/types";
import { ImageCard } from "./ImageCard";

type ImageListProps = {
  groupedImages: [string, DistillationImageVariant[]][];
  actionBusy: string;
  onAction: (type: string, factId: string, variantId: string, action: string) => void;
  onDirectAction: (type: string, factId: string, variantId: string, action: string) => void;
  onBulkAction: (action: "approve" | "reject", minScore?: number, itemType?: string) => void;
};

export function ImageList({ groupedImages, actionBusy, onAction, onDirectAction, onBulkAction }: ImageListProps) {
  return (
    <section className="images-panel" role="tabpanel" aria-label="Images">
      <div className="images-card-head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Images by Fact</h2>
        <button onClick={() => onBulkAction("approve", 0.85, "image")} title="Approve all images scoring 85%+">
          Approve all 85%+
        </button>
      </div>
      <div className="images-cards">
        {groupedImages.map(([factId, factImgs]) => (
          <div key={factId} className="images-card">
            <div className="images-card-head">
              <strong>
                Fact {factImgs[0]?.factOrder}: {factImgs[0]?.factText?.slice(0, 80)}
                {(factImgs[0]?.factText?.length || 0) > 80 ? "..." : ""}
              </strong>
              <span>{factImgs.length} variants</span>
            </div>
            {factImgs.map((img) => (
              <ImageCard
                key={img.variantId}
                image={img}
                actionBusy={actionBusy}
                onAction={onAction}
                onDirectAction={onDirectAction}
              />
            ))}
          </div>
        ))}
        {!groupedImages.length && (
          <div className="images-empty">No images for this scope. Generate images first.</div>
        )}
      </div>
    </section>
  );
}
