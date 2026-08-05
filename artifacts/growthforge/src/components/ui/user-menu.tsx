import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface UserMenuLink {
  label: string;
  href: string;
  icon?: ReactNode;
}

interface UserMenuProps {
  /** Extra links rendered above the "Sign Out" item (e.g. an admin console shortcut). */
  extraLinks?: UserMenuLink[];
  /** Where to send the user after signing out. Defaults to "/". */
  signOutRedirectUrl?: string;
}

/**
 * Replaces Clerk's `<UserButton>` — a small avatar button that opens a
 * dropdown with the signed-in user's email, optional extra links, and
 * "Sign Out". Colors match the app's dark theme (same green accent Clerk's
 * `<UserButton>` was themed with).
 */
export function UserMenu({ extraLinks = [], signOutRedirectUrl = "/" }: UserMenuProps) {
  const { user, signOut } = useAuth();
  const [, setLocation] = useLocation();

  if (!user) return null;

  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const initial = (email || "?")[0]?.toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-black shrink-0 outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-[#00E676]"
          style={{ background: "#00E676" }}
          aria-label="Account menu"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {email && (
          <>
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground text-xs">
              {email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {extraLinks.map((link) => (
          <DropdownMenuItem key={link.href} onSelect={() => setLocation(link.href)}>
            {link.icon}
            <span>{link.label}</span>
          </DropdownMenuItem>
        ))}
        {extraLinks.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={() => void signOut({ redirectUrl: signOutRedirectUrl })}>
          <LogOut className="h-4 w-4" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
