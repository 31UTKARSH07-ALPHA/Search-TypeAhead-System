import "./globals.css";

export const metadata = {
  title: "Search Typeahead",
  description: "Search typeahead system frontend"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
