/**
 * Pages a recipient or a signed-out operator can reach: the sign-in form and
 * the unsubscribe confirmation. No navigation, because there is nothing here
 * they are entitled to navigate to.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>;
}
