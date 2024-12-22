import axios from 'axios';
import { TP_ID } from '@prisma/client';
import { DynamicObjectService } from '../../generated/typescript/api/resources/crm/resources/dynamicObject/service/DynamicObjectService';
import { InternalServerError, NotFoundError } from '../../generated/typescript/api/resources/common';
import { logInfo, logError } from '../../helpers/logger';
import revertTenantMiddleware from '../../helpers/tenantIdMiddleware';
import revertAuthMiddleware from '../../helpers/authMiddleware';
import { isStandardError } from '../../helpers/error';
import { unifyObject } from '../../helpers/crm/transform';
import { getAssociationObjects, isValidAssociationTypeRequestedByUser } from '../../helpers/crm/hubspot';
import { CookieOptions, Request } from 'express';
import { GetDynamicObjectResponse, GetDynamicObjectsResponse, CreateOrUpdateDynamicObjectResponse } from '../../generated/typescript/api/resources/crm/resources/dynamicObject/types';
import { StandardObjects } from '../../constants/common';

const dynamicObjectService = new DynamicObjectService(
    {
        async getDynamicObject(
            req: Request<
                { objectType: string; id: string },
                GetDynamicObjectResponse,
                never,
                { fields?: string; associations?: string }
            >,
            res: {
                send: (responseBody: GetDynamicObjectResponse) => Promise<void>;
                cookie: (cookie: string, value: string, options?: CookieOptions) => void;
                locals: any;
            }
        ) {
            try {
                const connection = res.locals.connection;
                const account = res.locals.account;
                const objectId = req.params.id;
                const objectType = req.params.objectType; // This is the dynamic part
                const fields = req.query.fields;
                const thirdPartyId = connection.tp_id;
                const thirdPartyToken = connection.tp_access_token;
                const associations = req.query.associations ? req.query.associations.split(',') : [];

                logInfo(
                    'Revert::GET DYNAMIC OBJECT',
                    connection.app?.env?.accountId,
                    thirdPartyId,
                    thirdPartyToken,
                    objectId,
                    objectType
                );

                switch (thirdPartyId) {
                    case TP_ID.hubspot: {
                        const formattedFields = String(fields || '').split(',');
                        const validAssociations = [...associations].filter((item) =>
                            isValidAssociationTypeRequestedByUser(item),
                        );
                        
                        const url = `https://api.hubapi.com/crm/v3/objects/${objectType}/${objectId}?properties=${formattedFields}` +
                            (validAssociations.length > 0 ? `&associations=${validAssociations}` : '');

                        let object = await axios({
                            method: 'get',
                            url: url,
                            headers: {
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                        });

                        const associatedData = await getAssociationObjects(
                            object.data?.associations,
                            thirdPartyToken,
                            thirdPartyId,
                            connection,
                            account,
                            []
                        );

                        object = await unifyObject({
                            obj: { ...object.data, ...object.data?.properties, associations: associatedData },
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({ status: 'ok', result: object });
                        break;
                    }
                    case TP_ID.zohocrm: {
                        const response = await axios({
                            method: 'get',
                            url: `https://www.zohoapis.com/crm/v3/${objectType}/${objectId}${
                                fields ? `?fields=${fields}` : ''
                            }`,
                            headers: {
                                authorization: `Zoho-oauthtoken ${thirdPartyToken}`,
                            },
                        });

                        const object = await unifyObject({
                            obj: response.data.data?.[0],
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({ status: 'ok', result: object });
                        break;
                    }
                    case TP_ID.sfdc: {
                        const instanceUrl = connection.tp_account_url;
                        const response = await axios({
                            method: 'get',
                            url: `${instanceUrl}/services/data/v56.0/sobjects/${objectType}/${objectId}`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                            },
                        });

                        const object = await unifyObject({
                            obj: response.data,
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({ status: 'ok', result: object });
                        break;
                    }
                    case TP_ID.pipedrive: {
                        const result = await axios.get(
                            `${connection.tp_account_url}/v1/${objectType}s/${objectId}`,
                            {
                                headers: {
                                    Authorization: `Bearer ${thirdPartyToken}`,
                                },
                            },
                        );

                        const object = await unifyObject({
                            obj: result.data.data,
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({ status: 'ok', result: object });
                        break;
                    }
                    case TP_ID.closecrm: {
                        const response = await axios({
                            method: 'get',
                            url: `https://api.close.com/api/v1/${objectType}/${objectId}/`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                                Accept: 'application/json',
                            },
                        });

                        const object = await unifyObject({
                            obj: response.data,
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({ status: 'ok', result: object });
                        break;
                    }
                    case TP_ID.ms_dynamics_365_sales: {
                        const result = await axios({
                            method: 'get',
                            url: `${connection.tp_account_url}/api/data/v9.2/${objectType}s(${objectId})`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                                'OData-MaxVersion': '4.0',
                                'OData-Version': '4.0',
                                Accept: 'application/json',
                            },
                        });

                        const object = await unifyObject({
                            obj: result.data,
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({ status: 'ok', result: object });
                        break;
                    }
                    // Add other CRM cases here...
                    default: {
                        throw new NotFoundError({ error: 'Unrecognized CRM' });
                    }
                }
            } catch (error: any) {
                logError(error);
                console.error('Could not fetch dynamic object', error);
                if (isStandardError(error)) {
                    throw error;
                }
                throw new InternalServerError({ error: 'Internal server error' });
            }
        },

        async getDynamicObjects(
            req: Request<
                { objectType: string },
                GetDynamicObjectsResponse,
                never,
                { fields?: string; pageSize?: string; cursor?: string; associations?: string }
            >,
            res: {
                send: (responseBody: GetDynamicObjectsResponse) => Promise<void>;
                cookie: (cookie: string, value: string, options?: CookieOptions) => void;
                locals: any;
            }
        ) {
            try {
                const connection = res.locals.connection;
                const account = res.locals.account;
                const objectType = req.params.objectType;
                const fields = req.query.fields;
                const pageSize = parseInt(String(req.query.pageSize));
                const cursor = req.query.cursor;
                const thirdPartyId = connection.tp_id;
                const thirdPartyToken = connection.tp_access_token;
                const associations = req.query.associations ? req.query.associations.split(',') : [];

                logInfo(
                    'Revert::GET ALL DYNAMIC OBJECTS',
                    connection.app?.env?.accountId,
                    thirdPartyId,
                    thirdPartyToken,
                    objectType
                );

                switch (thirdPartyId) {
                    case TP_ID.hubspot: {
                        const formattedFields = String(fields || '').split(',');
                        const pagingString = `${pageSize ? `&limit=${pageSize}` : ''}${
                            cursor ? `&after=${cursor}` : ''
                        }`;
                        const validAssociations = [...associations].filter((item) =>
                            isValidAssociationTypeRequestedByUser(item),
                        );

                        const url = `https://api.hubapi.com/crm/v3/objects/${objectType}?properties=${formattedFields}${pagingString}` +
                            (validAssociations.length > 0 ? `&associations=${validAssociations}` : '');

                        let objects = await axios({
                            method: 'get',
                            url: url,
                            headers: {
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                        });

                        const nextCursor = objects.data?.paging?.next?.after || undefined;
                        const results = objects.data.results;

                        const unifiedObjects = await Promise.all(
                            results?.map(async (obj: any) => {
                                const associatedData = await getAssociationObjects(
                                    obj?.associations,
                                    thirdPartyToken,
                                    thirdPartyId,
                                    connection,
                                    account,
                                    []
                                );

                                return await unifyObject({
                                    obj: { ...obj, ...obj?.properties, associations: associatedData },
                                    tpId: thirdPartyId,
                                    objType: objectType as StandardObjects,
                                    tenantSchemaMappingId: connection.schema_mapping_id,
                                    accountFieldMappingConfig: account.accountFieldMappingConfig,
                                });
                            })
                        );

                        res.send({
                            status: 'ok',
                            next: nextCursor,
                            previous: undefined,
                            results: unifiedObjects,
                        });
                        break;
                    }
                    case TP_ID.zohocrm: {
                        const pagingString = `${pageSize ? `&per_page=${pageSize}` : ''}${
                            cursor ? `&page_token=${cursor}` : ''
                        }`;

                        const response = await axios({
                            method: 'get',
                            url: `https://www.zohoapis.com/crm/v3/${objectType}?fields=${fields}${pagingString}`,
                            headers: {
                                authorization: `Zoho-oauthtoken ${thirdPartyToken}`,
                            },
                        });

                        const nextCursor = response.data?.info?.next_page_token || undefined;
                        const prevCursor = response.data?.info?.previous_page_token || undefined;
                        const objects = response.data.data;

                        const unifiedObjects = await Promise.all(
                            objects?.map(
                                async (obj: any) =>
                                    await unifyObject({
                                        obj: obj,
                                        tpId: thirdPartyId,
                                        objType: objectType as StandardObjects,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    })
                            )
                        );

                        res.send({ 
                            status: 'ok', 
                            next: nextCursor, 
                            previous: prevCursor, 
                            results: unifiedObjects 
                        });
                        break;
                    }
                    case TP_ID.sfdc: {
                        let pagingString = `${pageSize ? `ORDER+BY+Id+DESC+LIMIT+${pageSize}+` : ''}${
                            cursor ? `OFFSET+${cursor}` : ''
                        }`;
                        if (!pageSize && !cursor) {
                            pagingString = 'LIMIT 200';
                        }
                        const instanceUrl = connection.tp_account_url;
                        const query = !fields || fields === 'ALL'
                            ? `SELECT+fields(all)+from+${objectType}+${pagingString}`
                            : `SELECT+${(fields as string).split(',').join('+,+')}+from+${objectType}+${pagingString}`;

                        const response = await axios({
                            method: 'get',
                            url: `${instanceUrl}/services/data/v56.0/query/?q=${query}`,
                            headers: {
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                        });

                        const nextCursor = pageSize
                            ? String(response.data?.totalSize + (parseInt(String(cursor)) || 0))
                            : undefined;
                        const prevCursor =
                            cursor && parseInt(String(cursor)) > 0
                                ? String(parseInt(String(cursor)) - response.data?.totalSize)
                                : undefined;

                        const objects = response.data?.records;
                        const unifiedObjects = await Promise.all(
                            objects?.map(
                                async (obj: any) =>
                                    await unifyObject({
                                        obj: obj,
                                        tpId: thirdPartyId,
                                        objType: objectType as StandardObjects,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    })
                            )
                        );

                        res.send({ 
                            status: 'ok', 
                            next: nextCursor, 
                            previous: prevCursor, 
                            results: unifiedObjects 
                        });
                        break;
                    }
                    case TP_ID.pipedrive: {
                        const pagingString = `${pageSize ? `&limit=${pageSize}` : ''}${
                            cursor ? `&start=${cursor}` : ''
                        }`;

                        const result = await axios.get(
                            `${connection.tp_account_url}/v1/${objectType}s?${pagingString}`,
                            {
                                headers: {
                                    Authorization: `Bearer ${thirdPartyToken}`,
                                },
                            },
                        );

                        const nextCursor = String(result.data?.additional_data?.pagination.next_start) || undefined;
                        const prevCursor = undefined;
                        const objects = result.data.data;

                        const unifiedObjects = await Promise.all(
                            objects?.map(
                                async (obj: any) =>
                                    await unifyObject({
                                        obj: obj,
                                        tpId: thirdPartyId,
                                        objType: objectType as StandardObjects,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    })
                            )
                        );

                        res.send({ 
                            status: 'ok', 
                            next: nextCursor, 
                            previous: prevCursor, 
                            results: unifiedObjects 
                        });
                        break;
                    }
                    case TP_ID.closecrm: {
                        const pagingString = `${pageSize ? `&_limit=${pageSize}` : ''}${
                            cursor ? `&_skip=${cursor}` : ''
                        }`;

                        const response = await axios({
                            method: 'get',
                            url: `https://api.close.com/api/v1/${objectType}/?${pagingString}`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                                Accept: 'application/json',
                            },
                        });

                        const hasMore = response.data?.has_more;
                        const objects = response.data?.data as any[];

                        const unifiedObjects = await Promise.all(
                            objects?.map(
                                async (obj: any) =>
                                    await unifyObject({
                                        obj: obj,
                                        tpId: thirdPartyId,
                                        objType: objectType as StandardObjects,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    })
                            )
                        );

                        let cursorVal = parseInt(String(cursor));
                        if (isNaN(cursorVal)) cursorVal = 0;
                        const nextSkipVal = hasMore ? cursorVal + pageSize : undefined;
                        const prevSkipVal = cursorVal > 0 ? String(Math.max(cursorVal - pageSize, 0)) : undefined;

                        res.send({
                            status: 'ok',
                            next: nextSkipVal ? String(nextSkipVal) : undefined,
                            previous: prevSkipVal,
                            results: unifiedObjects,
                        });
                        break;
                    }
                    case TP_ID.ms_dynamics_365_sales: {
                        const pagingString = cursor ? encodeURI(cursor).split('?')[1] : '';
                        let searchString = fields ? `$select=${fields}` : '';

                        const result = await axios({
                            method: 'get',
                            url: `${connection.tp_account_url}/api/data/v9.2/${objectType}s?${searchString}${pagingString}`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                                'OData-MaxVersion': '4.0',
                                'OData-Version': '4.0',
                                Accept: 'application/json',
                                Prefer: pageSize ? `odata.maxpagesize=${pageSize}` : '',
                            },
                        });

                        const unifiedObjects = await Promise.all(
                            result.data.value.map(
                                async (obj: any) =>
                                    await unifyObject({
                                        obj: obj,
                                        tpId: thirdPartyId,
                                        objType: objectType as StandardObjects,
                                        tenantSchemaMappingId: connection.schema_mapping_id,
                                        accountFieldMappingConfig: account.accountFieldMappingConfig,
                                    })
                            )
                        );

                        res.send({
                            status: 'ok',
                            next: result.data['@odata.nextLink'],
                            previous: undefined,
                            results: unifiedObjects,
                        });
                        break;
                    }
                    default: {
                        throw new NotFoundError({ error: 'Unrecognized CRM' });
                    }
                }
            } catch (error: any) {
                logError(error);
                console.error('Could not fetch dynamic objects', error);
                if (isStandardError(error)) {
                    throw error;
                }
                throw new InternalServerError({ error: 'Internal server error' });
            }
        },

        async createDynamicObject(
            req: Request<
                { objectType: string },
                CreateOrUpdateDynamicObjectResponse,
                unknown,
                never
            >,
            res: {
                send: (responseBody: CreateOrUpdateDynamicObjectResponse) => Promise<void>;
                cookie: (cookie: string, value: string, options?: CookieOptions) => void;
                locals: any;
            }
        ) {
            try {
                const connection = res.locals.connection;
                const account = res.locals.account;
                const objectType = req.params.objectType;
                const objectData = req.body;
                const thirdPartyId = connection.tp_id;
                const thirdPartyToken = connection.tp_access_token;

                logInfo(
                    'Revert::CREATE DYNAMIC OBJECT',
                    connection.app?.env?.accountId,
                    thirdPartyId,
                    thirdPartyToken,
                    objectType
                );

                switch (thirdPartyId) {
                    case TP_ID.hubspot: {
                        const response = await axios({
                            method: 'post',
                            url: `https://api.hubapi.com/crm/v3/objects/${objectType}`,
                            headers: {
                                'content-type': 'application/json',
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                            data: JSON.stringify({
                                properties: objectData
                            }),
                        });

                        const createdObject = await unifyObject({
                            obj: { ...response.data, ...response.data?.properties },
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({
                            status: 'ok',
                            message: `${objectType} created in Hubspot`,
                            result: createdObject
                        });
                        break;
                    }
                    case TP_ID.zohocrm: {
                        const response = await axios({
                            method: 'post',
                            url: `https://www.zohoapis.com/crm/v3/${objectType}`,
                            headers: {
                                authorization: `Zoho-oauthtoken ${thirdPartyToken}`,
                            },
                            data: JSON.stringify({
                                data: [objectData]
                            }),
                        });

                        const createdObject = await unifyObject({
                            obj: response.data.data?.[0],
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({ 
                            status: 'ok', 
                            message: `${objectType} created in Zoho`, 
                            result: createdObject 
                        });
                        break;
                    }
                    case TP_ID.sfdc: {
                        const instanceUrl = connection.tp_account_url;
                        const response = await axios({
                            method: 'post',
                            url: `${instanceUrl}/services/data/v56.0/sobjects/${objectType}/`,
                            headers: {
                                'content-type': 'application/json',
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                            data: JSON.stringify(objectData),
                        });

                        const createdObject = await unifyObject({
                            obj: response.data,
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({
                            status: 'ok',
                            message: `${objectType} created in Salesforce`,
                            result: createdObject
                        });
                        break;
                    }
                    case TP_ID.pipedrive: {
                        const response = await axios.post(
                            `${connection.tp_account_url}/v1/${objectType}s`,
                            objectData,
                            {
                                headers: {
                                    Authorization: `Bearer ${thirdPartyToken}`,
                                },
                            },
                        );

                        const createdObject = await unifyObject({
                            obj: response.data.data,
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({
                            status: 'ok',
                            message: `${objectType} created in Pipedrive`,
                            result: createdObject
                        });
                        break;
                    }
                    case TP_ID.closecrm: {
                        const response = await axios({
                            method: 'post',
                            url: `https://api.close.com/api/v1/${objectType}/`,
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${thirdPartyToken}`,
                            },
                            data: objectData,
                        });

                        const createdObject = await unifyObject({
                            obj: response.data,
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({
                            status: 'ok',
                            message: `${objectType} created in Close CRM`,
                            result: createdObject
                        });
                        break;
                    }
                    case TP_ID.ms_dynamics_365_sales: {
                        const response = await axios({
                            method: 'post',
                            url: `${connection.tp_account_url}/api/data/v9.2/${objectType}s`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                                'OData-MaxVersion': '4.0',
                                'OData-Version': '4.0',
                                Accept: 'application/json',
                                'Content-Type': 'application/json',
                            },
                            data: objectData,
                        });

                        const createdObject = await unifyObject({
                            obj: response.data,
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({
                            status: 'ok',
                            message: `${objectType} created in MS Dynamics 365`,
                            result: createdObject
                        });
                        break;
                    }
                    default: {
                        throw new NotFoundError({ error: 'Unrecognized CRM' });
                    }
                }
            } catch (error: any) {
                logError(error);
                console.error(`Could not create ${req.params.objectType}`, error);
                if (isStandardError(error)) {
                    throw error;
                }
                throw new InternalServerError({ error: 'Internal server error' });
            }
        },

        async updateDynamicObject(
            req: Request<
                { objectType: string; id: string },
                CreateOrUpdateDynamicObjectResponse,
                unknown,
                never
            >,
            res: {
                send: (responseBody: CreateOrUpdateDynamicObjectResponse) => Promise<void>;
                cookie: (cookie: string, value: string, options?: CookieOptions) => void;
                locals: any;
            }
        ) {
            try {
                const connection = res.locals.connection;
                const account = res.locals.account;
                const objectId = req.params.id;
                const objectType = req.params.objectType;
                const objectData = req.body;
                const thirdPartyId = connection.tp_id;
                const thirdPartyToken = connection.tp_access_token;

                logInfo(
                    'Revert::UPDATE DYNAMIC OBJECT',
                    connection.app?.env?.accountId,
                    thirdPartyId,
                    thirdPartyToken,
                    objectId,
                    objectType
                );

                switch (thirdPartyId) {
                    case TP_ID.hubspot: {
                        const response = await axios({
                            method: 'patch',
                            url: `https://api.hubapi.com/crm/v3/objects/${objectType}/${objectId}`,
                            headers: {
                                'content-type': 'application/json',
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                            data: JSON.stringify({
                                properties: objectData
                            }),
                        });

                        const updatedObject = await unifyObject({
                            obj: { ...response.data, ...response.data?.properties },
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({
                            status: 'ok',
                            message: `${objectType} updated in Hubspot`,
                            result: updatedObject
                        });
                        break;
                    }
                    case TP_ID.zohocrm: {
                        const response = await axios({
                            method: 'put',
                            url: `https://www.zohoapis.com/crm/v3/${objectType}/${objectId}`,
                            headers: {
                                authorization: `Zoho-oauthtoken ${thirdPartyToken}`,
                            },
                            data: JSON.stringify({
                                data: [objectData]
                            }),
                        });

                        const updatedObject = await unifyObject({
                            obj: response.data.data?.[0],
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({ 
                            status: 'ok', 
                            message: `${objectType} updated in Zoho`, 
                            result: updatedObject 
                        });
                        break;
                    }
                    case TP_ID.sfdc: {
                        const instanceUrl = connection.tp_account_url;
                        await axios({
                            method: 'patch',
                            url: `${instanceUrl}/services/data/v56.0/sobjects/${objectType}/${objectId}`,
                            headers: {
                                'content-type': 'application/json',
                                authorization: `Bearer ${thirdPartyToken}`,
                            },
                            data: JSON.stringify(objectData),
                        });

                        // SFDC patch doesn't return the updated object, so we need to fetch it
                        const response = await axios({
                            method: 'get',
                            url: `${instanceUrl}/services/data/v56.0/sobjects/${objectType}/${objectId}`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                            },
                        });

                        const updatedObject = await unifyObject({
                            obj: response.data,
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({
                            status: 'ok',
                            message: `${objectType} updated in Salesforce`,
                            result: updatedObject
                        });
                        break;
                    }
                    case TP_ID.pipedrive: {
                        const response = await axios.put(
                            `${connection.tp_account_url}/v1/${objectType}s/${objectId}`,
                            objectData,
                            {
                                headers: {
                                    Authorization: `Bearer ${thirdPartyToken}`,
                                },
                            },
                        );

                        const updatedObject = await unifyObject({
                            obj: response.data.data,
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({
                            status: 'ok',
                            message: `${objectType} updated in Pipedrive`,
                            result: updatedObject
                        });
                        break;
                    }
                    case TP_ID.closecrm: {
                        const response = await axios({
                            method: 'put',
                            url: `https://api.close.com/api/v1/${objectType}/${objectId}`,
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${thirdPartyToken}`,
                            },
                            data: objectData,
                        });

                        const updatedObject = await unifyObject({
                            obj: response.data,
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({
                            status: 'ok',
                            message: `${objectType} updated in Close CRM`,
                            result: updatedObject
                        });
                        break;
                    }
                    case TP_ID.ms_dynamics_365_sales: {
                        await axios({
                            method: 'patch',
                            url: `${connection.tp_account_url}/api/data/v9.2/${objectType}s(${objectId})`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                                'OData-MaxVersion': '4.0',
                                'OData-Version': '4.0',
                                Accept: 'application/json',
                                'Content-Type': 'application/json',
                            },
                            data: objectData,
                        });

                        // MS Dynamics doesn't return updated object, so fetch it
                        const getResponse = await axios({
                            method: 'get',
                            url: `${connection.tp_account_url}/api/data/v9.2/${objectType}s(${objectId})`,
                            headers: {
                                Authorization: `Bearer ${thirdPartyToken}`,
                                'OData-MaxVersion': '4.0',
                                'OData-Version': '4.0',
                                Accept: 'application/json',
                            },
                        });

                        const updatedObject = await unifyObject({
                            obj: getResponse.data,
                            tpId: thirdPartyId,
                            objType: objectType as StandardObjects,
                            tenantSchemaMappingId: connection.schema_mapping_id,
                            accountFieldMappingConfig: account.accountFieldMappingConfig,
                        });

                        res.send({
                            status: 'ok',
                            message: `${objectType} updated in MS Dynamics 365`,
                            result: updatedObject
                        });
                        break;
                    }
                    default: {
                        throw new NotFoundError({ error: 'Unrecognized CRM' });
                    }
                }
            } catch (error: any) {
                logError(error);
                console.error(`Could not update ${req.params.objectType}`, error);
                if (isStandardError(error)) {
                    throw error;
                }
                throw new InternalServerError({ error: 'Internal server error' });
            }
        }
    },
    [revertAuthMiddleware(), revertTenantMiddleware()]
);

export { dynamicObjectService }; 