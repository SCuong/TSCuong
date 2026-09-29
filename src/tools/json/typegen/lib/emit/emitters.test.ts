import { describe, expect, it } from 'vitest';
import { generateTypes, TARGETS, type GenerateOptions, type TargetId } from '../generate';
import { alignColumns, describeKinds, mixedNote, quoteString } from './common';
import { serdeCamel } from './rust';

/** Shared fixture: integer, float, renamed key, date-time, arrays, nested + nullable, optional in array items. */
const FIXTURE =
  '{"id": 7, "userName": "ada", "createdAt": "2024-03-18T09:30:00Z", "score": 9.5, "tags": ["a"], "address": {"city": "London", "zip": null}, "items": [{"sku": "A1", "qty": 2}, {"sku": "B2", "qty": 1, "note": "gift"}]}';

function gen(json: string, target: TargetId, options: Partial<GenerateOptions> = {}): string {
  const r = generateTypes(json, { target, ...options });
  if (!r.ok) throw new Error(r.error.message);
  return r.code;
}

const NULL_NOTE = 'Only null in the sample, so the real type is unknown.';

const EXPECTED: Record<TargetId, string> = {
  typescript: `export interface Root {
  id: number;
  userName: string;
  createdAt: string;
  score: number;
  tags: string[];
  address: Address;
  items: Item[];
}

export interface Address {
  city: string;
  zip: null; // ${NULL_NOTE}
}

export interface Item {
  sku: string;
  qty: number;
  note?: string;
}
`,
  'typescript-type': `export type Root = {
  id: number;
  userName: string;
  createdAt: string;
  score: number;
  tags: string[];
  address: Address;
  items: Item[];
};

export type Address = {
  city: string;
  zip: null; // ${NULL_NOTE}
};

export type Item = {
  sku: string;
  qty: number;
  note?: string;
};
`,
  zod: `import { z } from 'zod';

export const AddressSchema = z.object({
  city: z.string(),
  zip: z.null(), // ${NULL_NOTE}
});
export type Address = z.infer<typeof AddressSchema>;

export const ItemSchema = z.object({
  sku: z.string(),
  qty: z.number().int(),
  note: z.string().optional(),
});
export type Item = z.infer<typeof ItemSchema>;

export const RootSchema = z.object({
  id: z.number().int(),
  userName: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  score: z.number(),
  tags: z.array(z.string()),
  address: AddressSchema,
  items: z.array(ItemSchema),
});
export type Root = z.infer<typeof RootSchema>;
`,
  go: `package main

import "time"

type Root struct {
\tID        int64     \`json:"id"\`
\tUserName  string    \`json:"userName"\`
\tCreatedAt time.Time \`json:"createdAt"\`
\tScore     float64   \`json:"score"\`
\tTags      []string  \`json:"tags"\`
\tAddress   Address   \`json:"address"\`
\tItems     []Item    \`json:"items"\`
}

type Address struct {
\tCity string \`json:"city"\`
\tZip  any    \`json:"zip"\` // ${NULL_NOTE}
}

type Item struct {
\tSku  string  \`json:"sku"\`
\tQty  int64   \`json:"qty"\`
\tNote *string \`json:"note,omitempty"\`
}
`,
  rust: `// Requires serde (with the "derive" feature), serde_json, chrono (with the "serde" feature).
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    pub id: i64,
    pub user_name: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub score: f64,
    pub tags: Vec<String>,
    pub address: Address,
    pub items: Vec<Item>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Address {
    pub city: String,
    /// ${NULL_NOTE}
    pub zip: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub sku: String,
    pub qty: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}
`,
  'python-dataclass': `from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class Address:
    city: str
    zip: None  # ${NULL_NOTE}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Address:
        return cls(
            city=data["city"],
            zip=data["zip"],
        )


@dataclass
class Item:
    sku: str
    qty: int
    note: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Item:
        return cls(
            sku=data["sku"],
            qty=data["qty"],
            note=data.get("note"),
        )


@dataclass
class Root:
    id: int
    user_name: str
    created_at: str
    score: float
    tags: list[str]
    address: Address
    items: list[Item]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Root:
        return cls(
            id=data["id"],
            user_name=data["userName"],
            created_at=data["createdAt"],
            score=data["score"],
            tags=data["tags"],
            address=Address.from_dict(data["address"]),
            items=[Item.from_dict(v) for v in data["items"]],
        )
`,
  'python-typeddict': `from typing import NotRequired, TypedDict


class Address(TypedDict):
    city: str
    zip: None  # ${NULL_NOTE}


class Item(TypedDict):
    sku: str
    qty: int
    note: NotRequired[str]


class Root(TypedDict):
    id: int
    userName: str
    createdAt: str
    score: float
    tags: list[str]
    address: Address
    items: list[Item]
`,
  'python-pydantic': `from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class Address(BaseModel):
    city: str
    zip: None  # ${NULL_NOTE}


class Item(BaseModel):
    sku: str
    qty: int
    note: str | None = None


class Root(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    user_name: str = Field(alias="userName")
    created_at: datetime = Field(alias="createdAt")
    score: float
    tags: list[str]
    address: Address
    items: list[Item]
`,
  csharp: `#nullable enable

using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

public sealed record Root
{
    [JsonPropertyName("id")]
    public required long Id { get; init; }

    [JsonPropertyName("userName")]
    public required string UserName { get; init; }

    [JsonPropertyName("createdAt")]
    public required DateTimeOffset CreatedAt { get; init; }

    [JsonPropertyName("score")]
    public required double Score { get; init; }

    [JsonPropertyName("tags")]
    public required List<string> Tags { get; init; }

    [JsonPropertyName("address")]
    public required Address Address { get; init; }

    [JsonPropertyName("items")]
    public required List<Item> Items { get; init; }
}

public sealed record Address
{
    [JsonPropertyName("city")]
    public required string City { get; init; }

    // ${NULL_NOTE}
    [JsonPropertyName("zip")]
    public required JsonElement? Zip { get; init; }
}

public sealed record Item
{
    [JsonPropertyName("sku")]
    public required string Sku { get; init; }

    [JsonPropertyName("qty")]
    public required long Qty { get; init; }

    [JsonPropertyName("note")]
    public string? Note { get; init; }
}
`,
  kotlin: `import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class Root(
    val id: Long,
    val userName: String,
    val createdAt: String,
    val score: Double,
    val tags: List<String>,
    val address: Address,
    val items: List<Item>,
)

@Serializable
data class Address(
    val city: String,
    val zip: JsonElement?, // ${NULL_NOTE}
)

@Serializable
data class Item(
    val sku: String,
    val qty: Long,
    val note: String? = null,
)
`,
  'json-schema': `${JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Root',
      type: 'object',
      properties: {
        id: { type: 'integer' },
        userName: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
        score: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
        address: { $ref: '#/$defs/Address' },
        items: { type: 'array', items: { $ref: '#/$defs/Item' } },
      },
      required: ['id', 'userName', 'createdAt', 'score', 'tags', 'address', 'items'],
      $defs: {
        Address: {
          type: 'object',
          properties: { city: { type: 'string' }, zip: { $comment: NULL_NOTE, type: 'null' } },
          required: ['city', 'zip'],
        },
        Item: {
          type: 'object',
          properties: { sku: { type: 'string' }, qty: { type: 'integer' }, note: { type: 'string' } },
          required: ['sku', 'qty'],
        },
      },
    },
    null,
    2,
  )}\n`,
};

describe('shared fixture', () => {
  it.each(TARGETS.map((t) => t.id))('%s', (target) => {
    expect(gen(FIXTURE, target)).toBe(EXPECTED[target]);
  });

  it('every target has an expected output', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(TARGETS.map((t) => t.id).sort());
  });
});

describe('generateTypes', () => {
  it('reports invalid JSON with a position', () => {
    const r = generateTypes('{\n  "a": 1,\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBe(2);
      expect(r.error.message).toMatch(/Trailing comma/);
    }
  });

  it('counts types and fields', () => {
    const r = generateTypes(FIXTURE);
    expect(r.ok && [r.types, r.fields]).toEqual([3, 12]);
  });

  it('handles very large input', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ id: i, name: `n${i}`, nested: { value: i / 3, flag: i % 2 === 0 } }));
    const r = generateTypes(JSON.stringify(rows), { target: 'go' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.code).toContain('type RootItem struct');
  });

  it('turns Unicode and emoji keys into safe identifiers with renames', () => {
    const json = '{"名前": "x", "🚀 launch": 1, "café": true}';
    expect(gen(json, 'typescript')).toContain('"名前": string;');
    const go = gen(json, 'go');
    expect(go).toContain('Field  string `json:"名前"`');
    expect(go).toContain('Launch int64   // JSON key "🚀 launch" cannot be expressed in a Go struct tag');
    expect(gen(json, 'rust')).toContain('#[serde(rename = "café")]\n    pub caf: bool,');
    expect(gen(json, 'kotlin')).toContain('@SerialName("名前")\n    val field: String,');
  });
});

describe('TypeScript', () => {
  it('quotes keys that are not identifiers', () => {
    const ts = gen('{"first-name": 1, "2fa": true, "$ok": 1, "a b": null, "": 0}', 'typescript');
    expect(ts).toContain('"first-name": number;');
    expect(ts).toContain('"2fa": boolean;');
    expect(ts).toContain('$ok: number;');
    expect(ts).toContain('"a b": null;');
    expect(ts).toContain('"": number;');
  });

  it('supports readonly and no export', () => {
    const ts = gen('{"a": [1]}', 'typescript', { readonly: true, exportTypes: false });
    expect(ts).toBe('interface Root {\n  readonly a: number[];\n}\n');
  });

  it('avoids global type names', () => {
    const ts = gen('{"record": {"a": 1}, "date": {"b": 2}, "promise": {"c": 3}}', 'typescript');
    expect(ts).toContain('record: RecordObject;');
    expect(ts).toContain('export interface DateObject {');
    expect(ts).toContain('promise: PromiseObject;');
  });

  it('renders unions, nullable items, maps and empty objects', () => {
    const ts = gen('{"u": [1, "a", null], "m": {"1": [true]}, "e": {}, "n": [null, {"x": 1}]}', 'typescript');
    expect(ts).toContain('u: (number | string | null)[];');
    expect(ts).toContain('m: Record<string, boolean[]>;');
    expect(ts).toContain('e: Record<string, unknown>; // Always an empty object in the sample.');
    expect(ts).toContain('n: (NItem | null)[];');
  });

  it('aliases top-level arrays and primitives', () => {
    expect(gen('[{"a": 1}]', 'typescript')).toBe('export type Root = RootItem[];\n\nexport interface RootItem {\n  a: number;\n}\n');
    expect(gen('"x"', 'typescript', { rootName: 'Name' })).toBe('export type Name = string;\n');
    expect(gen('[]', 'typescript')).toBe(
      'export type Root = unknown[]; // Always an empty array in the sample, so the item type is unknown.\n',
    );
    expect(gen('null', 'typescript-type')).toBe('export type Root = null; // Only null in the sample, so the real type is unknown.\n');
  });

  it('uses the root name for the root object', () => {
    expect(gen('{"a": 1}', 'typescript', { rootName: 'api-response' })).toContain('export interface ApiResponse {');
  });

  it('applies the null handling mode', () => {
    const json = '[{"a": 1, "b": null}, {"a": 2, "b": 3, "c": "x"}]';
    expect(gen(json, 'typescript', { nullMode: 'loose' })).toContain('  a: number;\n  b?: number | null;\n  c?: string | null;');
    expect(gen(json, 'typescript', { nullMode: 'all-optional' })).toContain('  a?: number;\n  b?: number | null;\n  c?: string;');
  });
});

describe('Zod', () => {
  it('orders schemas so dependencies come first and chains modifiers', () => {
    const zod = gen('[{"a": {"b": 1}, "c": null}, {"a": null, "c": "x", "d": [1.5]}]', 'zod');
    expect(zod.indexOf('const ASchema')).toBeLessThan(zod.indexOf('const RootItemSchema'));
    expect(zod).toContain('a: ASchema.nullable(),');
    expect(zod).toContain('c: z.string().nullable(),');
    expect(zod).toContain('d: z.array(z.number()).optional(),');
    expect(zod).toContain('export const RootSchema = z.array(RootItemSchema);');
  });

  it('omits format checks when formats are off', () => {
    expect(gen('{"e": "a@example.com"}', 'zod', { formats: false })).toContain('e: z.string(),');
    expect(gen('{"e": "a@example.com"}', 'zod')).toContain('e: z.string().email(),');
  });

  it('renders unions and records', () => {
    const zod = gen('{"u": [1, "a"], "m": {"2024-01-01": 1.5}}', 'zod', { exportTypes: false });
    expect(zod).toContain('u: z.array(z.union([z.number().int(), z.string()])),');
    expect(zod).toContain('m: z.record(z.string(), z.number()),');
    expect(zod).not.toContain('export ');
  });
});

describe('Go', () => {
  it('uses initialisms, pointers, omitempty and aligned columns', () => {
    const go = gen('[{"user_id": 1, "avatarUrl": "x", "p": {"q": 1}}, {"user_id": 2, "avatarUrl": null}]', 'go');
    expect(go).toContain('\tUserID    int64   `json:"user_id"`');
    expect(go).toContain('\tAvatarURL *string `json:"avatarUrl"`');
    expect(go).toContain('\tP         *P      `json:"p,omitempty"`');
    expect(go).toContain('type Root []RootItem');
  });

  it('dedupes field names and handles awkward keys', () => {
    const go = gen('{"userId": 1, "user_id": 2, "-": 3, "a,b": 4, "": 5, "2fa": 6, "q\\"x": 7}', 'go');
    expect(go).toContain('UserID   int64 `json:"userId"`');
    expect(go).toContain('UserID2  int64 `json:"user_id"`');
    expect(go).toContain('Field    int64 `json:"-,"`');
    expect(go).toContain('Field2   int64  // JSON key');
    expect(go).toContain('`json:"-,"`');
    expect(go).toContain('// JSON key "a,b" cannot be expressed in a Go struct tag');
    expect(go).toContain('// JSON key "" cannot be expressed in a Go struct tag');
    expect(go).toContain('Field2fa int64 `json:"2fa"`');
    expect(go).toContain('// JSON key "q\\"x" cannot be expressed in a Go struct tag');
  });

  it('comments mixed types and keeps slices and maps without pointers', () => {
    const go = gen('[{"v": 1, "l": [1], "m": {"1": 2}}, {"v": "x", "l": null}]', 'go');
    expect(go).toContain('V any              `json:"v"` // integer or string');
    expect(go).toContain('L []int64          `json:"l"`');
    expect(go).toContain('M map[string]int64 `json:"m,omitempty"`');
  });

  it('sanitizes the package name and skips time without formats', () => {
    const go = gen('{"t": "2024-01-01T00:00:00Z"}', 'go', { goPackage: 'My-Models!', formats: false });
    expect(go.startsWith('package mymodels\n')).toBe(true);
    expect(go).not.toContain('import "time"');
    expect(go).toContain('T string `json:"t"`');
    expect(gen('1', 'go', { goPackage: '9bad' }).startsWith('package main\n')).toBe(true);
  });

  it('aliases unknown roots', () => {
    expect(gen('[1, "a"]', 'go')).toContain('type Root []any // items: integer or string');
    expect(gen('null', 'go')).toContain('type Root = any // Only null');
  });
});

describe('Rust', () => {
  it('escapes keywords with raw identifiers or a trailing underscore', () => {
    const rust = gen('{"type": "a", "self": 1, "match": true, "crate": 2}', 'rust');
    expect(rust).toContain('pub r#type: String,');
    expect(rust).toContain('pub r#match: bool,');
    // serde's camelCase rule maps `self_` back to "self", so one rename_all replaces two renames.
    expect(rust).toContain('#[serde(rename_all = "camelCase")]');
    expect(rust).toContain('    pub self_: i64,');
    expect(rust).toContain('    pub crate_: i64,');
    const explicit = gen('{"self": 1, "first_name": 2}', 'rust');
    expect(explicit).not.toContain('rename_all');
    expect(explicit).toContain('#[serde(rename = "self")]\n    pub self_: i64,');
  });

  it('chooses rename_all only when it saves renames', () => {
    const plain = gen('{"first_name": 1, "last_name": 2, "age": 3}', 'rust');
    expect(plain).not.toContain('rename_all');
    const camel = gen('{"firstName": 1, "lastName": 2, "age": 3, "user_ID": 4}', 'rust');
    expect(camel).toContain('#[serde(rename_all = "camelCase")]');
    expect(camel).toContain('#[serde(rename = "user_ID")]\n    pub user_id: i64,');
  });

  it('emits untagged enums for mixed values and a HashMap import', () => {
    const rust = gen('{"id": [1, "a", {"x": 1}], "m": {"1": 2}}', 'rust');
    expect(rust).toContain('use std::collections::HashMap;');
    expect(rust).toContain('pub id: Vec<IdItemUnion>,');
    expect(rust).toContain(
      '#[serde(untagged)]\npub enum IdItemUnion {\n    Integer(i64),\n    String(String),\n    IdItem(IdItem),\n}',
    );
    expect(rust).toContain('pub m: HashMap<String, i64>,');
    const simple = gen('{"value": [1, "a"], "v": {"n": [true, 1.5]}}', 'rust');
    expect(simple).toContain('pub value: Vec<ValueItem>,');
    expect(simple).toContain('pub enum ValueItem {\n    Integer(i64),\n    String(String),\n}');
    expect(simple).toContain('pub n: Vec<NItem>,');
    expect(simple).toContain('pub enum NItem {\n    Bool(bool),\n    Double(f64),\n}');
    const direct = gen('[{"value": 1}, {"value": "a"}]', 'rust');
    expect(direct).toContain('pub value: ValueUnion,');
  });

  it('does not double-wrap optional nullable fields', () => {
    const rust = gen('[{"a": null, "b": 1}, {"a": 2}]', 'rust');
    expect(rust).toContain('pub a: Option<i64>,');
    expect(rust).toContain('#[serde(skip_serializing_if = "Option::is_none")]\n    pub b: Option<i64>,');
  });

  it('keeps JSON keys when idiomatic names are off', () => {
    const rust = gen('{"firstName": 1, "a-b": 2}', 'rust', { idiomaticNames: false });
    expect(rust).toContain('pub firstName: i64,');
    expect(rust).toContain('#[serde(rename = "a-b")]\n    pub a_b: i64,');
  });

  it('matches serde camelCase conversion', () => {
    expect(serdeCamel('user_name')).toBe('userName');
    expect(serdeCamel('field_2fa')).toBe('field2fa');
    expect(serdeCamel('a__b')).toBe('aB');
    expect(serdeCamel('id')).toBe('id');
  });
});

describe('Python', () => {
  const json = '{"class": 1, "from": "x", "json": true, "first-name": "a", "_id": 5, "__secret": 1}';

  it('renames keywords and reserved names with aliases (pydantic)', () => {
    const py = gen(json, 'python-pydantic');
    expect(py).toContain('class_: int = Field(alias="class")');
    expect(py).toContain('from_: str = Field(alias="from")');
    expect(py).toContain('json_: bool = Field(alias="json")');
    expect(py).toContain('first_name: str = Field(alias="first-name")');
    expect(py).toContain('id: int = Field(alias="_id")');
    expect(py).toContain('secret: int = Field(alias="__secret")');
  });

  it('uses the functional TypedDict syntax for keys that are not identifiers', () => {
    const py = gen(json, 'python-typeddict');
    expect(py).toContain('Root = TypedDict(\n    "Root",\n    {\n        "class": int,');
    expect(gen('{"a": 1, "b_c": 2}', 'python-typeddict')).toContain('class Root(TypedDict):\n    a: int\n    b_c: int');
  });

  it('puts required dataclass fields first and converts nested values in from_dict', () => {
    const py = gen(
      '[{"opt": {"x": 1}, "req": 1, "list": [[{"y": 1}]], "map": {"1": {"z": null}}, "u": [1, {"w": 1}]}, {"req": 2, "list": [], "map": {}, "u": []}]',
      'python-dataclass',
    );
    expect(py).toMatch(
      /class RootItem:\n {4}req: int\n {4}list: list\[list\[ListItem\]\]\n {4}map: dict\[str, MapItem\]\n {4}u: list\[int \| UItem\]\n {4}opt: Opt \| None = None/,
    );
    expect(py).toContain('opt=Opt.from_dict(data["opt"]) if data.get("opt") is not None else None,');
    expect(py).toContain('list=[[ListItem.from_dict(v2) for v2 in v] for v in data["list"]],');
    expect(py).toContain('map={k: MapItem.from_dict(v) for k, v in data["map"].items()},');
    expect(py).toContain('u=[UItem.from_dict(v) if isinstance(v, dict) else v for v in data["u"]],');
    expect(py).toContain('Root = list[RootItem]');
  });

  it('keeps datetime as str except in pydantic', () => {
    const json2 = '{"at": "2024-01-01T10:00:00+02:00"}';
    expect(gen(json2, 'python-dataclass')).toContain('at: str');
    expect(gen(json2, 'python-pydantic')).toContain('from datetime import datetime');
    expect(gen(json2, 'python-pydantic')).toContain('at: datetime');
    expect(gen(json2, 'python-pydantic', { formats: false })).toContain('at: str');
  });

  it('wraps non-object roots in RootModel for pydantic', () => {
    const py = gen('[1, 2]', 'python-pydantic');
    expect(py).toContain('from pydantic import BaseModel, RootModel');
    expect(py).toContain('class Root(RootModel[list[int]]):\n    pass');
  });

  it('avoids type names that clash with keywords and typing names', () => {
    const py = gen('{"none": {"a": 1}, "any": {"b": 2}}', 'python-dataclass');
    expect(py).toContain('class NoneObject:');
    expect(py).toContain('class AnyObject:');
  });
});

describe('C#', () => {
  it('renames properties that clash with the type name or object members', () => {
    const cs = gen('{"item": {"item": 1, "toString": "x", "equals": true}}', 'csharp');
    expect(cs).toContain('public sealed record Item');
    expect(cs).toContain('[JsonPropertyName("item")]\n    public required long ItemValue { get; init; }');
    expect(cs).toContain('[JsonPropertyName("toString")]\n    public required string ToStringValue { get; init; }');
    expect(cs).toContain('public required bool EqualsValue { get; init; }');
  });

  it('supports classes, kept names and escaped keywords', () => {
    const cs = gen('{"class": 1, "Name": "x"}', 'csharp', { csharpStyle: 'class', idiomaticNames: false });
    expect(cs).toContain('public sealed class Root');
    expect(cs).toContain('public required long @class { get; set; }');
    expect(cs).not.toContain('[JsonPropertyName("class")]');
    expect(cs).toContain('public required string Name { get; set; }');
  });

  it('notes the root type when it is not an object', () => {
    expect(gen('[1]', 'csharp')).toContain('// The JSON root is not an object: deserialize it as List<long> (Root).');
  });

  it('comments mixed values', () => {
    expect(gen('{"v": [1, "a"]}', 'csharp')).toContain('    // items: integer or string\n    [JsonPropertyName("v")]');
  });
});

describe('Kotlin', () => {
  it('backticks keywords and escapes $ in serial names', () => {
    const kt = gen('{"object": 1, "is": true, "$price": 2}', 'kotlin');
    expect(kt).toContain('val `object`: Long,');
    expect(kt).toContain('val `is`: Boolean,');
    expect(kt).toContain('@SerialName("\\$price")\n    val price: Long,');
  });

  it('emits empty types as plain classes and aliases for non-object roots', () => {
    expect(gen('[{"a": {}}]', 'kotlin')).toContain('typealias Root = List<RootItem>');
    expect(gen('{"a": [1, "x"]}', 'kotlin')).toContain('val a: List<JsonElement>, // items: integer or string');
  });
});

describe('JSON Schema', () => {
  it('wraps nullable references and complex unions in anyOf', () => {
    const schema = JSON.parse(gen('[{"p": {"x": 1}, "u": 1}, {"p": null, "u": {"y": 2}}]', 'json-schema'));
    const item = schema.$defs.RootItem;
    expect(item.properties.p).toEqual({ anyOf: [{ $ref: '#/$defs/P' }, { type: 'null' }] });
    expect(item.properties.u).toEqual({ anyOf: [{ type: 'integer' }, { $ref: '#/$defs/U' }] });
    expect(schema.type).toBe('array');
  });

  it('uses type arrays for simple unions and keeps formats', () => {
    const schema = JSON.parse(gen('{"v": [1, "2024-01-01", null]}', 'json-schema'));
    expect(schema.properties.v.items).toEqual({ type: ['integer', 'string', 'null'], format: 'date' });
  });

  it('keeps __proto__ as a real property', () => {
    const schema = JSON.parse(gen('{"__proto__": 1}', 'json-schema'));
    expect(Object.keys(schema.properties)).toEqual(['__proto__']);
  });
});

describe('common helpers', () => {
  it('aligns columns like gofmt', () => {
    expect(alignColumns([['a', 'int', 'x'], ['bbb', 'string', 'y', '// c'], ['cc', '', '']])).toEqual([
      'a   int    x',
      'bbb string y // c',
      'cc',
    ]);
  });

  it('describes kinds for comments', () => {
    const r = generateTypes('{"a": [1, "x", true, null]}', { target: 'go' });
    expect(r.ok && r.code).toContain('// items: boolean, integer, string or null');
    expect(describeKinds({ kind: 'string' })).toBe('string');
    expect(mixedNote({ kind: 'integer' })).toBeUndefined();
  });

  it('quotes strings for C-like languages', () => {
    expect(quoteString('a"b\\c\n$\f')).toBe('"a\\"b\\\\c\\n$\\u000c"');
    expect(quoteString('$x', { dollar: true })).toBe('"\\$x"');
    expect(quoteString('\u0001\ud800', { braces: true })).toBe('"\\u{1}\\u{fffd}"');
  });
});
