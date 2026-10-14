import styles from './TrainingOverview.module.css';

/** Keep the home layout visible without inventing plan or workout facts. */
export function TrainingHomeLoading({
  name, program = false, error, onRetry,
}: {
  name?: string;
  program?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  return <div className={styles.screen} aria-busy={!error}>
    <header className={styles.title}>
      <p className={styles.eyebrow}>{program ? 'Program' : 'Your training'}</p>
      <h1>{program ? name ?? 'Program' : 'Ready when you are.'}</h1>
      <p className={styles.subtitle}>{name ?? 'Your training, one workout at a time.'}</p>
      <span className={styles.loadingLink} aria-hidden="true" />
    </header>
    <div className={styles.layout}>
      <section className={styles.stack}>
        <section className={`${styles.card} ${styles.hero} ${styles.loadingHero}`}>
          <p role={error ? 'alert' : 'status'}>
            {error ?? 'Getting your training ready…'}
          </p>
          {error && onRetry && <button type="button" onClick={onRetry}>Try again</button>}
          {!error && <div className={styles.loadingLine} aria-hidden="true" />}
        </section>
        {!error && <div className={styles.loadingChoices} aria-hidden="true">
          {[0, 1, 2].map(row => <div className={styles.loadingChoice} key={row}>
            <span className={styles.loadingCircle} /><span className={styles.loadingLine} />
          </div>)}
        </div>}
      </section>
      <section className={`${styles.card} ${styles.preview}`} aria-hidden="true">
        <div className={styles.loadingLine} />
        <div className={styles.loadingLine} />
        <div className={styles.loadingLine} />
      </section>
    </div>
  </div>;
}
