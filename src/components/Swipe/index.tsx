import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import SwipeCardView, {
  type SwipeCardData,
  type SwipeDirection,
} from '@app/components/Swipe/SwipeCardView';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowUturnLeftIcon,
  CheckIcon,
  EyeIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type SwipeMediaType = 'movie' | 'tv' | 'book';

interface DeckResponse {
  mediaType: SwipeMediaType;
  ranked: boolean;
  remaining: number;
  cards: SwipeCardData[];
}

interface SwipeProfile {
  tasteNotes: string;
  seriesRequest: 'first-season' | 'all-seasons';
  bookFormat: 'ebook' | 'audiobook';
}

const messages = defineMessages('components.Swipe', {
  title: 'Swipe',
  unavailable:
    'Swipe is not available. An administrator may have turned it off, or your account cannot make requests.',
  intro:
    'Swipe right to request, left to pass, or up if you have already seen or read it.',
  movies: 'Movies',
  series: 'Series',
  books: 'Books',
  request: 'Request',
  pass: 'Pass',
  seen: 'Seen It',
  undo: 'Undo',
  preferences: 'Preferences',
  refresh: 'New Picks',
  aiRanked: 'Ordered for you by AI',
  loadError: 'Recommendations could not be loaded.',
  retry: 'Retry',
  empty: 'You Are All Caught Up',
  emptyHelp:
    'Request or swipe a few more titles elsewhere, then check back for new picks.',
  requested: '{title} requested.',
  requestFailed: '{title} could not be requested: {reason}',
  undone: 'Brought back {title}.',
  saveFailed: 'Your swipe could not be saved. Try again.',
  keyboardHint: 'Keyboard: ← pass, → request, ↑ seen it, Backspace to undo.',
  tasteNotes: 'What Are You in the Mood For?',
  tasteNotesHelp:
    'Optional. Used to order your picks when AI ordering is turned on, for example “cozy mysteries” or “nothing too scary”.',
  seriesRequest: 'When I Request a Series',
  firstSeason: 'Request the first season',
  allSeasons: 'Request every season',
  bookFormat: 'When I Request a Book',
  audiobook: 'Request the audiobook',
  ebook: 'Request the ebook',
  save: 'Save',
  close: 'Close',
});

const TABS: { mediaType: SwipeMediaType; label: keyof typeof messages }[] = [
  { mediaType: 'movie', label: 'movies' },
  { mediaType: 'tv', label: 'series' },
  { mediaType: 'book', label: 'books' },
];

const EXIT_MS = 320;
const REFILL_BELOW = 4;

const DECISION: Record<SwipeDirection, 'want' | 'pass' | 'seen'> = {
  right: 'want',
  left: 'pass',
  up: 'seen',
};

/** The request body a right swipe submits. Exposed for tests. */
export const requestBodyFor = (card: SwipeCardData, profile: SwipeProfile) => {
  if (card.mediaType === 'movie') {
    return { mediaType: 'movie', mediaId: Number(card.id) };
  }
  if (card.mediaType === 'tv') {
    return {
      mediaType: 'tv',
      mediaId: Number(card.id),
      seasons: profile.seriesRequest === 'all-seasons' ? 'all' : [1],
    };
  }
  return {
    mediaType: 'book',
    mediaId: card.id,
    authorId: card.authorId,
    format: profile.bookFormat,
  };
};

const errorMessage = (error: unknown) =>
  axios.isAxiosError(error) && typeof error.response?.data?.message === 'string'
    ? error.response.data.message
    : undefined;

const Swipe = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [mediaType, setMediaType] = useState<SwipeMediaType>('movie');
  const [cards, setCards] = useState<SwipeCardData[]>([]);
  const [exiting, setExiting] = useState<{
    id: string;
    direction: SwipeDirection;
  }>();
  const [busy, setBusy] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [draftProfile, setDraftProfile] = useState<SwipeProfile>();
  const lastLoaded = useRef<string>(undefined);

  const { data: status, error: statusError } = useSWR<{
    aiRanking: boolean;
  }>('/api/v1/swipe/status');
  const unavailable =
    axios.isAxiosError(statusError) &&
    (statusError.response?.status === 404 ||
      statusError.response?.status === 403);
  const { data: profile, mutate: mutateProfile } = useSWR<SwipeProfile>(
    '/api/v1/swipe/profile'
  );
  const {
    data: deck,
    error,
    isValidating,
    mutate: reloadDeck,
  } = useSWR<DeckResponse>(`/api/v1/swipe/deck?mediaType=${mediaType}`, {
    revalidateOnFocus: false,
  });

  // Replace the local stack when a new deck arrives; keep cards the user is
  // looking at and append the rest.
  useEffect(() => {
    if (!deck) return;
    const key = `${deck.mediaType}:${deck.cards.map((card) => card.id).join(',')}`;
    if (lastLoaded.current === key) return;
    lastLoaded.current = key;
    setCards((current) => {
      if (current[0]?.mediaType !== deck.mediaType) return deck.cards;
      const seen = new Set(current.map((card) => card.id));
      return [...current, ...deck.cards.filter((card) => !seen.has(card.id))];
    });
  }, [deck]);

  useEffect(() => {
    setCards([]);
    lastLoaded.current = undefined;
  }, [mediaType]);

  const top = cards[0];

  const swipe = useCallback(
    async (direction: SwipeDirection) => {
      if (!top || busy || exiting || !profile) return;
      setBusy(true);
      try {
        if (direction === 'right') {
          try {
            await axios.post('/api/v1/request', requestBodyFor(top, profile));
          } catch (failure) {
            addToast(
              intl.formatMessage(messages.requestFailed, {
                title: top.title,
                reason: errorMessage(failure) ?? '',
              }),
              { appearance: 'error', autoDismiss: true }
            );
            return;
          }
          addToast(
            intl.formatMessage(messages.requested, { title: top.title }),
            {
              appearance: 'success',
              autoDismiss: true,
            }
          );
        }
        try {
          await axios.post('/api/v1/swipe/decisions', {
            mediaType: top.mediaType,
            id: top.id,
            decision: DECISION[direction],
          });
        } catch (failure) {
          // A right swipe already made its request; only a lost pass/seen
          // needs to keep the card.
          if (direction !== 'right') {
            addToast(intl.formatMessage(messages.saveFailed), {
              appearance: 'error',
              autoDismiss: true,
            });
            return;
          }
          void failure;
        }
        setExiting({ id: top.id, direction });
        window.setTimeout(() => {
          setExiting(undefined);
          setCards((current) => {
            const next = current.filter((card) => card.id !== top.id);
            if (next.length < REFILL_BELOW) void reloadDeck();
            return next;
          });
        }, EXIT_MS);
      } finally {
        setBusy(false);
      }
    },
    [addToast, busy, exiting, intl, profile, reloadDeck, top]
  );

  const undo = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await axios.post<{ card: SwipeCardData }>(
        '/api/v1/swipe/undo',
        { mediaType }
      );
      const card = response.data.card;
      setCards((current) => [
        card,
        ...current.filter((item) => item.id !== card.id),
      ]);
      addToast(intl.formatMessage(messages.undone, { title: card.title }), {
        appearance: 'info',
        autoDismiss: true,
      });
    } catch (failure) {
      const message = errorMessage(failure);
      if (message) {
        addToast(message, { appearance: 'info', autoDismiss: true });
      }
    } finally {
      setBusy(false);
    }
  }, [addToast, busy, intl, mediaType]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        showPreferences ||
        target?.closest('input, textarea, select, [contenteditable]')
      ) {
        return;
      }
      const direction: SwipeDirection | undefined =
        event.key === 'ArrowRight'
          ? 'right'
          : event.key === 'ArrowLeft'
            ? 'left'
            : event.key === 'ArrowUp'
              ? 'up'
              : undefined;
      if (direction) {
        event.preventDefault();
        void swipe(direction);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        void undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPreferences, swipe, undo]);

  const savePreferences = async () => {
    if (!draftProfile) return;
    try {
      const response = await axios.put<SwipeProfile>(
        '/api/v1/swipe/profile',
        draftProfile
      );
      await mutateProfile(response.data, { revalidate: false });
      setShowPreferences(false);
      if (response.data.tasteNotes !== profile?.tasteNotes) {
        setCards([]);
        lastLoaded.current = undefined;
        void reloadDeck();
      }
    } catch (failure) {
      addToast(
        errorMessage(failure) ?? intl.formatMessage(messages.saveFailed),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    }
  };

  const visible = cards.slice(0, 3);
  const loading = !deck && !error;

  return (
    <div className="page-layout">
      <PageTitle title={intl.formatMessage(messages.title)} />
      <div className="page-title-row">
        <h1 className="page-title">{intl.formatMessage(messages.title)}</h1>
        {(loading || (isValidating && cards.length === 0)) && (
          <span className="page-status">
            <LoadingSpinner />
          </span>
        )}
      </div>
      <p className="card-body-text">{intl.formatMessage(messages.intro)}</p>
      <div className="app-action-row" role="tablist">
        {TABS.map((tab) => (
          <Button
            key={tab.mediaType}
            role="tab"
            aria-selected={mediaType === tab.mediaType}
            buttonType={mediaType === tab.mediaType ? 'primary' : 'default'}
            buttonSize="sm"
            onClick={() => setMediaType(tab.mediaType)}
          >
            {intl.formatMessage(messages[tab.label])}
          </Button>
        ))}
        <Button
          buttonType="default"
          buttonSize="sm"
          onClick={() => {
            setDraftProfile(profile);
            setShowPreferences(true);
          }}
          disabled={!profile}
        >
          {intl.formatMessage(messages.preferences)}
        </Button>
      </div>
      {status?.aiRanking && deck?.ranked && (
        <p className="card-subheading">
          {intl.formatMessage(messages.aiRanked)}
        </p>
      )}

      {unavailable ? (
        <section className="app-card-main card-layout">
          <p className="card-body-text">
            {intl.formatMessage(messages.unavailable)}
          </p>
        </section>
      ) : error && cards.length === 0 ? (
        <section className="app-card-main card-layout">
          <h2 className="card-title">
            {intl.formatMessage(messages.loadError)}
          </h2>
          <div className="app-action-row">
            <Button
              buttonType="default"
              buttonSize="sm"
              onClick={() => void reloadDeck()}
            >
              {intl.formatMessage(messages.retry)}
            </Button>
          </div>
        </section>
      ) : deck && cards.length === 0 && !isValidating ? (
        <section className="app-card-main card-layout">
          <h2 className="page-heading">{intl.formatMessage(messages.empty)}</h2>
          <p className="card-body-text">
            {intl.formatMessage(messages.emptyHelp)}
          </p>
          <div className="app-action-row">
            <Button
              buttonType="primary"
              buttonSize="sm"
              onClick={() =>
                void axios
                  .get<DeckResponse>(
                    `/api/v1/swipe/deck?mediaType=${mediaType}&refresh=true`
                  )
                  .then((response) =>
                    reloadDeck(response.data, { revalidate: false })
                  )
              }
            >
              {intl.formatMessage(messages.refresh)}
            </Button>
          </div>
        </section>
      ) : (
        <>
          <div className="swipe-deck" aria-live="polite">
            {visible
              .map((card, index) => (
                <SwipeCardView
                  key={card.id}
                  card={card}
                  position={index as 0 | 1 | 2}
                  exit={exiting?.id === card.id ? exiting.direction : undefined}
                  disabled={busy || !!exiting}
                  onSwipe={(direction) => void swipe(direction)}
                />
              ))
              .reverse()}
          </div>
          <div className="swipe-actions">
            <Button
              buttonType="default"
              buttonSize="sm"
              disabled={busy}
              onClick={() => void undo()}
            >
              <ArrowUturnLeftIcon />
              <span>{intl.formatMessage(messages.undo)}</span>
            </Button>
            <Button
              buttonType="danger"
              buttonSize="sm"
              disabled={!top || busy || !!exiting}
              onClick={() => void swipe('left')}
            >
              <XMarkIcon />
              <span>{intl.formatMessage(messages.pass)}</span>
            </Button>
            <Button
              buttonType="primary"
              buttonSize="sm"
              disabled={!top || busy || !!exiting}
              onClick={() => void swipe('up')}
            >
              <EyeIcon />
              <span>{intl.formatMessage(messages.seen)}</span>
            </Button>
            <Button
              buttonType="success"
              buttonSize="sm"
              disabled={!top || busy || !!exiting || !profile}
              onClick={() => void swipe('right')}
            >
              <CheckIcon />
              <span>{intl.formatMessage(messages.request)}</span>
            </Button>
          </div>
          <p className="settings-form-row-description">
            {intl.formatMessage(messages.keyboardHint)}
          </p>
        </>
      )}

      {showPreferences && draftProfile && (
        <Modal
          title={intl.formatMessage(messages.preferences)}
          onCancel={() => setShowPreferences(false)}
          cancelText={intl.formatMessage(messages.close)}
          onOk={() => void savePreferences()}
          okText={intl.formatMessage(messages.save)}
        >
          <div className="form-row">
            <label htmlFor="swipe-taste-notes">
              {intl.formatMessage(messages.tasteNotes)}
            </label>
            <div className="form-input-area">
              <div className="form-input-field">
                <textarea
                  id="swipe-taste-notes"
                  maxLength={1000}
                  rows={3}
                  value={draftProfile.tasteNotes}
                  onChange={(event) =>
                    setDraftProfile({
                      ...draftProfile,
                      tasteNotes: event.currentTarget.value,
                    })
                  }
                />
              </div>
              <p className="settings-form-row-description">
                {intl.formatMessage(messages.tasteNotesHelp)}
              </p>
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="swipe-series-request">
              {intl.formatMessage(messages.seriesRequest)}
            </label>
            <div className="form-input-area">
              <div className="form-input-field">
                <select
                  id="swipe-series-request"
                  value={draftProfile.seriesRequest}
                  onChange={(event) =>
                    setDraftProfile({
                      ...draftProfile,
                      seriesRequest: event.currentTarget
                        .value as SwipeProfile['seriesRequest'],
                    })
                  }
                >
                  <option value="first-season">
                    {intl.formatMessage(messages.firstSeason)}
                  </option>
                  <option value="all-seasons">
                    {intl.formatMessage(messages.allSeasons)}
                  </option>
                </select>
              </div>
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="swipe-book-format">
              {intl.formatMessage(messages.bookFormat)}
            </label>
            <div className="form-input-area">
              <div className="form-input-field">
                <select
                  id="swipe-book-format"
                  value={draftProfile.bookFormat}
                  onChange={(event) =>
                    setDraftProfile({
                      ...draftProfile,
                      bookFormat: event.currentTarget
                        .value as SwipeProfile['bookFormat'],
                    })
                  }
                >
                  <option value="audiobook">
                    {intl.formatMessage(messages.audiobook)}
                  </option>
                  <option value="ebook">
                    {intl.formatMessage(messages.ebook)}
                  </option>
                </select>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Swipe;
