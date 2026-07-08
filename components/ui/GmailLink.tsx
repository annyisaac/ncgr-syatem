/** Renders an email address as a Gmail-compose link (opens in a new tab). */
export function GmailLink({ email }: { email: string }) {
  const href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
    email
  )}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-gold-dark underline underline-offset-2 hover:text-gold"
    >
      {email}
    </a>
  );
}
