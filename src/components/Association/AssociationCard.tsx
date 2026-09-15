import PersonCard from '@app/components/PersonCard';
import TitleCard from '@app/components/TitleCard';
import type { AssociationNode } from '@app/hooks/useAssociations';

const AssociationCard = ({ node }: { node: AssociationNode }) => {
  switch (node.mediaType) {
    case 'movie':
      return (
        <TitleCard
          id={node.id}
          image={node.posterPath}
          status={node.mediaInfo?.status}
          status4k={node.mediaInfo?.status4k}
          summary={node.overview}
          title={node.title}
          year={node.releaseDate}
          mediaType="movie"
          inProgress={(node.mediaInfo?.downloadStatus ?? []).length > 0}
          inProgress4k={(node.mediaInfo?.downloadStatus4k ?? []).length > 0}
          hideAssociationWhenEmpty
        />
      );
    case 'tv':
      return (
        <TitleCard
          id={node.id}
          image={node.posterPath}
          status={node.mediaInfo?.status}
          status4k={node.mediaInfo?.status4k}
          summary={node.overview}
          title={node.name}
          year={node.firstAirDate}
          mediaType="tv"
          inProgress={(node.mediaInfo?.downloadStatus ?? []).length > 0}
          inProgress4k={(node.mediaInfo?.downloadStatus4k ?? []).length > 0}
          hideAssociationWhenEmpty
        />
      );
    case 'album':
      return (
        <TitleCard
          id={node.id}
          image={node.posterPath}
          status={node.mediaInfo?.status}
          title={node.title}
          artist={node['artist-credit']?.[0]?.name}
          year={node['first-release-date']?.split('-')[0]}
          mediaType="album"
          availableQualities={node.availableQualities}
          qualityStatuses={node.qualityStatuses}
          needsCoverArt={node.needsCoverArt}
          hideAssociationWhenEmpty
        />
      );
    case 'artist':
      return (
        <TitleCard
          id={node.id}
          image={node.artistThumb ?? undefined}
          title={node.name}
          mediaType="artist"
          hideAssociationWhenEmpty
        />
      );
    case 'book':
      return (
        <TitleCard
          id={node.id}
          image={node.posterPath}
          status={node.mediaInfo?.status}
          title={node.title}
          year={node.firstPublishYear?.toString()}
          mediaType="book"
          hideAssociationWhenEmpty
        />
      );
    case 'person':
      return (
        <PersonCard
          personId={node.id}
          name={node.name}
          profilePath={node.profilePath}
        />
      );
    default:
      return null;
  }
};

export default AssociationCard;
