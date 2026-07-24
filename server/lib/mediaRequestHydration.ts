import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { In } from 'typeorm';

export const hydrateMediaRequestRelations = async (
  requests: MediaRequest[],
  options: { includeMediaIdentifiers?: boolean } = {}
): Promise<MediaRequest[]> => {
  const ids = [...new Set(requests.map((request) => request.id))].filter(
    (id) => Number.isSafeInteger(id) && id > 0
  );
  if (!ids.length) {
    return requests;
  }

  const hydrated = await getRepository(MediaRequest).find({
    where: { id: In(ids) },
    relations: {
      media: options.includeMediaIdentifiers ? { identifiers: true } : true,
      seasons: true,
      modifiedBy: true,
      requestedBy: true,
    },
    // This helper receives an explicit id list without pagination, so the join
    // strategy safely loads nested media identifiers. TypeORM's query strategy
    // does not reliably load media.identifiers for this nested relation.
  });
  const hydratedById = new Map(
    hydrated.map((request) => [request.id, request])
  );

  return requests.map((request) => hydratedById.get(request.id) ?? request);
};
