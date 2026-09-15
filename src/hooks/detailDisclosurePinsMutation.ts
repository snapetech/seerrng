import type {
  DetailDisclosurePin,
  UserSettingsDetailDisclosureResponse,
} from '@server/interfaces/api/userSettingsInterfaces';

export type DetailDisclosurePins =
  Required<UserSettingsDetailDisclosureResponse>;

export interface DetailDisclosurePinsMutation {
  key: string;
  revision: number;
  previous: DetailDisclosurePins;
  next: DetailDisclosurePins;
}

export class DetailDisclosurePinsMutationState {
  private key = '';
  private revision = 0;
  private value: DetailDisclosurePins = {
    cast: false,
    crew: false,
    artists: false,
    subjectTags: false,
  };

  public synchronize(key: string, value: DetailDisclosurePins): void {
    if (key !== this.key) {
      this.key = key;
      this.revision += 1;
    }
    this.value = value;
  }

  public begin(
    section: DetailDisclosurePin,
    pinned: boolean
  ): DetailDisclosurePinsMutation {
    const previous = this.value;
    const next = { ...previous, [section]: pinned };
    const mutation = {
      key: this.key,
      revision: ++this.revision,
      previous,
      next,
    };
    this.value = next;
    return mutation;
  }

  public isCurrent(mutation: DetailDisclosurePinsMutation): boolean {
    return mutation.key === this.key && mutation.revision === this.revision;
  }

  public rollback(
    mutation: DetailDisclosurePinsMutation
  ): DetailDisclosurePins | undefined {
    if (!this.isCurrent(mutation)) {
      return undefined;
    }

    this.value = mutation.previous;
    return this.value;
  }
}
