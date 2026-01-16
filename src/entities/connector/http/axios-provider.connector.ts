import axios, { isAxiosError } from "axios";
import { Headers, HttpProviderConnector } from "./http-provider.connector";

export class AxiosProviderConnector implements HttpProviderConnector {
  async get<T>(url: string, headers: Headers): Promise<T> {
    try {
      const res = await axios.get<T>(url, {
        headers,
      });

      return res.data;
    } catch (error) {
      throw error;
    }
  }

  async post<T>(url: string, data: unknown, headers: Headers): Promise<T> {
    try {
      const res = await axios.post<T>(url, data, {
        headers,
      });

      return res.data;
    } catch (error) {
      throw error;
    }
  }
}
