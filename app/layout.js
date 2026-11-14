import './style.css';

export const metadata = {
  title: 'Catch Me Up',
  description: 'Find the moment that makes the lecture click.',
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
