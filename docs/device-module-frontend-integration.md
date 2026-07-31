# Device Module Frontend Integration

This guide explains how a frontend can connect to the backend device module.

## Base URL

Use the frontend environment variable that points to the backend API.

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;
```

Example:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## Endpoints

```txt
GET    /device
GET    /device/:id
POST   /device
PATCH  /device/:id
DELETE /device/:id
```

Note: `DELETE /device/:id` may require authentication depending on the active app guard setup.

## Device Type

```ts
export type Device = {
  id: string;
  model: string;
  serialNumber: string;
  storesId: string;
  createdAt: string;
  updatedAt: string;
};
```

## List Devices

Use `GET /device` for paginated device lists and tables.

```txt
GET /device?page=1&pageSize=10&q=ZKTeco
```

Query params:

```ts
export type DeviceListQuery = {
  page?: number;
  pageSize?: number;
  q?: string;
};
```

Defaults:

```txt
page=1
pageSize=10
```

The `q` parameter searches by device `model` or `serialNumber`.

Response:

```ts
export type DeviceListResponse = {
  items: Device[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};
```

Example frontend request:

```ts
export async function getDevices({
  page = 1,
  pageSize = 10,
  q = '',
}: DeviceListQuery = {}): Promise<DeviceListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (q.trim()) {
    params.set('q', q.trim());
  }

  const response = await fetch(`${API_BASE_URL}/device?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to fetch devices');
  }

  return response.json();
}
```

## Get One Device

Use this when opening a device details page or edit form.

```txt
GET /device/:id
```

Example:

```ts
export async function getDevice(id: string): Promise<Device> {
  const response = await fetch(`${API_BASE_URL}/device/${id}`);

  if (!response.ok) {
    throw new Error('Failed to fetch device');
  }

  return response.json();
}
```

## Create Device

Use `POST /device` to create a device.

Request body:

```ts
export type CreateDeviceInput = {
  model: string;
  serialNumber: string;
  storesId: string;
};
```

Example:

```ts
export async function createDevice(input: CreateDeviceInput): Promise<Device> {
  const response = await fetch(`${API_BASE_URL}/device`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error('Failed to create device');
  }

  return response.json();
}
```

## Update Device

Use `PATCH /device/:id` to update a device.

Request body:

```ts
export type UpdateDeviceInput = Partial<CreateDeviceInput>;
```

Example:

```ts
export async function updateDevice(
  id: string,
  input: UpdateDeviceInput,
): Promise<Device> {
  const response = await fetch(`${API_BASE_URL}/device/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error('Failed to update device');
  }

  return response.json();
}
```

## Delete Device

Use `DELETE /device/:id` to remove a device.

Example:

```ts
export async function deleteDevice(id: string): Promise<Device> {
  const response = await fetch(`${API_BASE_URL}/device/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete device');
  }

  return response.json();
}
```

## UI Integration Prompt

Use the backend device API to build a device management page. Fetch devices from `GET /device` using `page`, `pageSize`, and optional `q` query params. Display the returned `items` in a table, use `totalItems` and `totalPages` for pagination controls, and debounce the search input before sending the request. Use `POST /device` for creation, `PATCH /device/:id` for updates, `GET /device/:id` for details, and `DELETE /device/:id` for removal. The create and update forms should collect `model`, `serialNumber`, and `storesId`.
