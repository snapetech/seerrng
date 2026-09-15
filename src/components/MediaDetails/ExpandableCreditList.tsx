import CachedImage from '@app/components/Common/CachedImage';
import Link from 'next/link';

export interface ExpandableCredit {
  id: number;
  name: string;
  role: string;
  profilePath?: string;
}

interface ExpandableCreditListProps {
  title: string;
  credits: ExpandableCredit[];
  emptyLabel: string;
}

const ExpandableCreditList = ({
  title,
  credits,
  emptyLabel,
}: ExpandableCreditListProps) => (
  <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
    <h2 className="media-inset-heading mb-2">{title}</h2>
    {credits.length === 0 ? (
      <p className="refreshed-detail-text-muted text-xs">{emptyLabel}</p>
    ) : (
      <div className="scrollable-card -mr-3 grid max-h-[252px] grid-cols-3 gap-1.5 overflow-y-auto pr-3">
        {credits.map((credit, index) => (
          <Link
            key={`${credit.id}-${credit.role}-${index}`}
            href={`/person/${credit.id}`}
            prefetch={false}
            className="group flex h-20 min-w-0 overflow-hidden rounded-lg border border-gray-700 bg-gray-900/30 transition hover:border-indigo-400 hover:bg-indigo-500/15 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
          >
            <span className="relative h-full w-[54px] flex-shrink-0 overflow-hidden border-r border-gray-700 bg-white">
              <CachedImage
                type="tmdb"
                src={
                  credit.profilePath
                    ? `https://image.tmdb.org/t/p/w185${credit.profilePath}`
                    : '/images/camera-shy-profile-placeholder.png'
                }
                alt=""
                fill
                sizes="54px"
                className="object-cover object-top"
              />
            </span>
            <span className="flex min-w-0 flex-1 flex-col justify-center px-2 py-1.5">
              <span className="truncate text-xs font-semibold text-gray-200 group-hover:text-white">
                {credit.name}
              </span>
              <span className="refreshed-detail-text mt-0.5 line-clamp-2 text-xs leading-4">
                {credit.role}
              </span>
            </span>
          </Link>
        ))}
      </div>
    )}
  </section>
);

export default ExpandableCreditList;
