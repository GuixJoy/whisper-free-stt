import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";

interface ActivityItem {
  time: string;
  event: string;
  hasInfo?: boolean;
}

interface ActivityRowProps extends React.HTMLAttributes<HTMLDivElement> {
  item: ActivityItem;
}

export const ActivityRow = forwardRef<HTMLDivElement, ActivityRowProps>(
  ({ className, item, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center h-16 px-4 hover:bg-white/[0.03] transition-colors border-b border-white/[0.04] last:border-b-0",
          className,
        )}
        {...props}
      >
        <div className="w-[110px] text-[15px] text-time">
          {item.time}
        </div>
        <div className="flex items-center gap-2 text-[15px] text-text-primary">
          {item.event}
          {item.hasInfo && (
            <Info size={14} className="text-text-muted" />
          )}
        </div>
      </div>
    );
  },
);

ActivityRow.displayName = "ActivityRow";

interface ActivityTableProps extends React.HTMLAttributes<HTMLDivElement> {
  date: string;
  items: ActivityItem[];
}

export const ActivityTable = forwardRef<HTMLDivElement, ActivityTableProps>(
  ({ className, date, items, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col bg-app-surface-dark rounded-card border border-white/[0.05] overflow-hidden",
          className,
        )}
        {...props}
      >
        {/* Date header */}
        <div className="px-4 py-3 border-b border-white/[0.04]">
          <h3 className="text-label uppercase text-text-secondary tracking-[0.05em]">
            {date}
          </h3>
        </div>

        {/* Items */}
        <div className="flex flex-col">
          {items.map((item, index) => (
            <ActivityRow key={index} item={item} />
          ))}
        </div>
      </div>
    );
  },
);

ActivityTable.displayName = "ActivityTable";
