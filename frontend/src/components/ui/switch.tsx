import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-transparent bg-line-2 p-0.5 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:bg-white/15 dark:data-checked:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[18px] rounded-full bg-white shadow-sm ring-0 transition-transform data-checked:translate-x-4 dark:data-checked:bg-navy-900"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
