"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "@/lib/utils"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"

// user-feature 2026-06-19: system-wide fix for "click a dropdown and see a
// raw database id (cuid)". Base UI's <Select.Value> renders the raw selected
// VALUE unless the Root is given an `items` value→label map. Almost every
// select in the app sets `value={x.id}` with `<SelectItem value={x.id}>{name}`
// but no items map, so the trigger showed the id once a row was selected (or
// when a value was pre-set from URL/state before the popup ever opened).
//
// Instead of patching ~50 call sites, we derive the items map here: walk the
// declared <SelectItem> children, collect {value, label:<their text>}, and
// pass it to Base UI's Root. This reads the JSX element tree (not the DOM),
// so labels resolve even while the popup is closed. Call sites are unchanged.
type DerivedItem = { value: unknown; label: React.ReactNode };

// value→label map derived from the declared <SelectItem> children, shared
// with <SelectValue> so the trigger renders the label — never a raw id —
// even when the selected value matches no rendered item.
const SelectLabelContext = React.createContext<Map<string, React.ReactNode> | null>(null);

function collectSelectItems(children: React.ReactNode, out: DerivedItem[]): void {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: React.ReactNode };
    // Any descendant carrying a `value` prop is a SelectItem — the
    // structural parts (Trigger/Value/Content/Group) don't take `value`,
    // so this is robust without depending on component-reference equality
    // (which can break across bundler/module boundaries).
    if (props.value !== undefined && typeof props.value !== "object") {
      out.push({ value: props.value, label: props.children });
    }
    // Recurse through wrappers (SelectContent, SelectGroup, fragments, arrays).
    if (props.children) collectSelectItems(props.children, out);
  });
}

// A selected value that matches no rendered item AND looks like a database
// id (long alphanumeric, e.g. a cuid) must never reach the UI — show the
// placeholder instead. Readable values (enum codes) still render as-is.
function looksLikeRawId(s: string): boolean {
  return /^[a-z0-9]{16,}$/.test(s) && !s.includes(" ");
}

function Select({
  children,
  items,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root<any, any>>) {
  // Derive the items map from the declared SelectItem children (or honour an
  // explicit `items` prop). Used both by Base UI's Root and by our
  // SelectValue (via context) so the label always resolves.
  const { derived, labelMap } = React.useMemo(() => {
    const out: DerivedItem[] = [];
    if (items) out.push(...(items as DerivedItem[]));
    else collectSelectItems(children, out);
    const map = new Map<string, React.ReactNode>();
    for (const it of out) map.set(String(it.value), it.label);
    return { derived: out.length ? out : undefined, labelMap: map };
  }, [children, items]);
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <SelectPrimitive.Root items={derived as any} {...(props as any)}>
      <SelectLabelContext.Provider value={labelMap}>{children}</SelectLabelContext.Provider>
    </SelectPrimitive.Root>
  );
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({
  className,
  placeholder,
  children,
  ...props
}: SelectPrimitive.Value.Props) {
  const labelMap = React.useContext(SelectLabelContext);

  // If a caller passed their own children (node or render fn), respect it.
  // Otherwise resolve the label from the derived item map. Critically, a
  // value that matches no item and looks like a raw id renders as the
  // placeholder — so a database cuid never leaks into the trigger.
  const resolve = React.useCallback(
    (value: unknown): React.ReactNode => {
      if (value == null || value === "") return placeholder ?? null;
      if (Array.isArray(value)) {
        const parts = value
          .map((v) => labelMap?.get(String(v)))
          .filter((l): l is React.ReactNode => l != null);
        if (parts.length === 0) return placeholder ?? null;
        return parts.map((l, i) => (
          <React.Fragment key={i}>
            {i > 0 ? ", " : null}
            {l}
          </React.Fragment>
        ));
      }
      const key = String(value);
      if (labelMap?.has(key)) return labelMap.get(key);
      if (looksLikeRawId(key)) return placeholder ?? null;
      return key;
    },
    [labelMap, placeholder],
  );

  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      placeholder={placeholder}
      {...props}
    >
      {children ?? resolve}
    </SelectPrimitive.Value>
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn("relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // audit v12 MEDIUM (MED-74): use logical padding classes (pe-8, ps-1.5) for RTL support
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pe-8 ps-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      {/* audit v12 MEDIUM (MED-74): logical end-2 instead of right-2 for RTL support */}
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute end-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
