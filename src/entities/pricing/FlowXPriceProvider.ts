import { GraphqlProvider, standardShortCoinType } from "@flowx-finance/sdk";
import { PriceProvider } from "./PriceProvider";
import { gql } from "graphql-request";

const MULTI_GET_COINS_GRAPHQL_QUERY = gql`
  query MultiGetCoins($coinTypes: [String!]!) {
    multiGetCoins(coinTypes: $coinTypes) {
      markets {
        price
      }
    }
  }
`;

export class FlowXPriceProvider implements PriceProvider {
  public readonly graphqlProvider!: GraphqlProvider;

  constructor() {
    this.graphqlProvider = new GraphqlProvider("mainnet", { keepalive: true });
  }

  async getPrice(token: string): Promise<number> {
    const response: any = await this.graphqlProvider.client.request(
      MULTI_GET_COINS_GRAPHQL_QUERY,
      {
        coinTypes: [standardShortCoinType(token)],
      }
    );

    return Number(response.multiGetCoins[0]?.markets.price);
  }
}
