import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type { BookHomeSectionPreference } from '@server/constants/bookHomeSections';
import {
  BOOK_HOME_SECTION_OPTIONS,
  DEFAULT_BOOK_HOME_SECTIONS,
} from '@server/constants/bookHomeSections';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.UserProfile.UserSettings.BookHomeSections',
  {
    title: 'Book and audiobook home sections',
    description:
      'Choose the book and audiobook rows on your Discover home, hide rows, and move them into your preferred order.',
    addSection: 'Add section',
    save: 'Save sections',
    saving: 'Saving…',
    enabled: 'Show on home',
    moveUp: 'Move up',
    moveDown: 'Move down',
    empty: 'No sections are selected. Add one to show books on Discover.',
    saved: 'Book home sections saved.',
    failed: 'Book home sections could not be saved.',
  }
);

const BookHomeSections = () => {
  const intl = useIntl();
  const { user } = useUser();
  const endpoint = user?.id
    ? `/api/v1/user/${user.id}/settings/discover-book-sections`
    : null;
  const { data, error, mutate } = useSWR<{
    sections: BookHomeSectionPreference[];
  }>(endpoint);
  const [sections, setSections] = useState<BookHomeSectionPreference[]>(
    DEFAULT_BOOK_HOME_SECTIONS
  );
  const [selected, setSelected] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    if (data?.sections) setSections(data.sections);
  }, [data]);

  if (!user?.id || (!data && !error)) return <LoadingSpinner />;

  const addSection = () => {
    if (!selected || sections.some((item) => item.key === selected)) return;
    setSections([
      ...sections,
      { key: selected as BookHomeSectionPreference['key'], enabled: true },
    ]);
    setSelected('');
  };
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    setSections(next);
  };
  const save = async () => {
    if (!endpoint) return;
    setSaving(true);
    setMessage(undefined);
    setFailure(undefined);
    try {
      await axios.post(endpoint, { sections });
      setMessage(intl.formatMessage(messages.saved));
      await mutate();
    } catch {
      setFailure(intl.formatMessage(messages.failed));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="section">
      <h3 className="heading">{intl.formatMessage(messages.title)}</h3>
      <p className="description">{intl.formatMessage(messages.description)}</p>
      <div className="form-row">
        <label htmlFor="book-home-section-add">
          {intl.formatMessage(messages.addSection)}
        </label>
        <div className="form-input-area">
          <select
            id="book-home-section-add"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">{intl.formatMessage(messages.addSection)}</option>
            {BOOK_HOME_SECTION_OPTIONS.filter(
              (option) => !sections.some((item) => item.key === option.key)
            ).map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <Button
            buttonType="default"
            type="button"
            disabled={!selected}
            onClick={addSection}
          >
            {intl.formatMessage(messages.addSection)}
          </Button>
        </div>
      </div>
      {sections.length === 0 && (
        <p className="description">{intl.formatMessage(messages.empty)}</p>
      )}
      {sections.map((section, index) => {
        const option = BOOK_HOME_SECTION_OPTIONS.find(
          (item) => item.key === section.key
        );
        if (!option) return null;
        return (
          <div className="app-list-row" key={section.key}>
            <span className="app-list-label">{option.label}</span>
            <label className="app-list-value">
              <input
                type="checkbox"
                checked={section.enabled}
                onChange={(event) =>
                  setSections(
                    sections.map((item) =>
                      item.key === section.key
                        ? { ...item, enabled: event.target.checked }
                        : item
                    )
                  )
                }
              />{' '}
              {intl.formatMessage(messages.enabled)}
            </label>
            <div className="app-action-row">
              <Button
                buttonType="default"
                buttonSize="sm"
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                {intl.formatMessage(messages.moveUp)}
              </Button>
              <Button
                buttonType="default"
                buttonSize="sm"
                type="button"
                disabled={index === sections.length - 1}
                onClick={() => move(index, 1)}
              >
                {intl.formatMessage(messages.moveDown)}
              </Button>
            </div>
          </div>
        );
      })}
      <div className="settings-page-actions">
        <Button
          buttonType="primary"
          type="button"
          disabled={saving}
          onClick={() => void save()}
        >
          {intl.formatMessage(saving ? messages.saving : messages.save)}
        </Button>
      </div>
      {message && (
        <p className="description" role="status">
          {message}
        </p>
      )}
      {failure && <p className="error">{failure}</p>}
    </section>
  );
};

export default BookHomeSections;
