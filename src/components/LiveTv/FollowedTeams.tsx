import Button from '@app/components/Common/Button';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

interface SportsTeam {
  dataset: string;
  league?: string;
  team: string;
}

interface Follow {
  id: number;
  dataset: string;
  team: string;
}

const messages = defineMessages('components.LiveTv.FollowedTeams', {
  title: 'Followed Teams',
  description:
    'SeerrNG requests a recording of each upcoming game for these teams when Tunerr finds it in the guide. Recordings follow the usual approval rules.',
  none: 'You are not following any teams.',
  team: 'Team',
  choose: 'Choose a team',
  follow: 'Follow',
  unfollow: 'Unfollow {team}',
  unavailable:
    'Team schedules are not available. An administrator can turn on sports automation in IPTV Tunerr.',
  failed: 'The team could not be updated.',
});

const FollowedTeams = ({ canRequest }: { canRequest: boolean }) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data: teams, error: teamsError } = useSWR<{
    enabled?: boolean;
    teams: SportsTeam[];
  }>('/api/v1/live-tv/sports/teams', { revalidateOnFocus: false });
  const { data: follows, mutate } = useSWR<{ results: Follow[] }>(
    '/api/v1/live-tv/sports/follows'
  );
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);

  const followed = new Set(
    (follows?.results ?? []).map(
      (follow) => `${follow.dataset}|${follow.team.toLowerCase()}`
    )
  );
  const available = (teams?.teams ?? []).filter(
    (team) => !followed.has(`${team.dataset}|${team.team.toLowerCase()}`)
  );

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await mutate();
    } catch (failure) {
      addToast(
        axios.isAxiosError(failure) &&
          typeof failure.response?.data?.message === 'string'
          ? failure.response.data.message
          : intl.formatMessage(messages.failed),
        { appearance: 'error', autoDismiss: true }
      );
    } finally {
      setBusy(false);
    }
  };

  const unavailable =
    !!teamsError || (teams && (teams.enabled === false || !teams.teams.length));

  return (
    <section className="app-card-sub card-layout">
      <h2 className="card-title">{intl.formatMessage(messages.title)}</h2>
      <p className="card-body-text">
        {intl.formatMessage(messages.description)}
      </p>
      {(follows?.results ?? []).length === 0 ? (
        <p className="card-body-text">{intl.formatMessage(messages.none)}</p>
      ) : (
        <div className="app-action-row">
          {follows?.results.map((follow) => (
            <Button
              key={follow.id}
              buttonType="default"
              buttonSize="sm"
              disabled={busy}
              aria-label={intl.formatMessage(messages.unfollow, {
                team: follow.team,
              })}
              onClick={() =>
                void run(() =>
                  axios.delete(`/api/v1/live-tv/sports/follows/${follow.id}`)
                )
              }
            >
              {follow.team} ×
            </Button>
          ))}
        </div>
      )}
      {unavailable ? (
        <p className="card-body-text">
          {intl.formatMessage(messages.unavailable)}
        </p>
      ) : (
        <div className="form-row">
          <label htmlFor="followed-team">
            {intl.formatMessage(messages.team)}
          </label>
          <div className="form-input-area">
            <div className="form-input-field">
              <select
                id="followed-team"
                value={selected}
                disabled={busy || !canRequest}
                onChange={(event) => setSelected(event.currentTarget.value)}
              >
                <option value="">{intl.formatMessage(messages.choose)}</option>
                {available.map((team) => (
                  <option
                    key={`${team.dataset}|${team.team}`}
                    value={`${team.dataset}|${team.team}`}
                  >
                    {team.team} ({(team.league ?? team.dataset).toUpperCase()})
                  </option>
                ))}
              </select>
            </div>
            <div className="app-action-row">
              <Button
                buttonType="primary"
                buttonSize="sm"
                disabled={busy || !selected || !canRequest}
                onClick={() => {
                  const [dataset, ...rest] = selected.split('|');
                  void run(() =>
                    axios.post('/api/v1/live-tv/sports/follows', {
                      dataset,
                      team: rest.join('|'),
                    })
                  ).then(() => setSelected(''));
                }}
              >
                {intl.formatMessage(messages.follow)}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default FollowedTeams;
