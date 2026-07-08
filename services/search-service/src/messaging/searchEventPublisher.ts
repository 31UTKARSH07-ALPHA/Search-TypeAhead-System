import type { SearchEvent } from "@typeahead/shared-types";

export interface SearchEventPublisher {
  connect(): Promise<void>;
  publish(event: SearchEvent): Promise<void>;
  close(): Promise<void>;
}
