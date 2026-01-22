import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';
import styles from './TopNav.module.css';

export function TopNav() {
  return (
    <header className={styles.nav}>
      <div className={styles.container}>
        <div className={styles.left}>
          <Link href="/" className={styles.wordmark}>RocketShip</Link>
        </div>
        <div className={styles.right}>
          <Link href="/setup" className={styles.link}>Start</Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
