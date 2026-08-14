import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaginatedResponse } from '../common/paginated-response';
import { CreateServiceDto } from './dto/create-service.dto';
import { GetServiceQueryDto } from './dto/get-service.dto';
import { ListServicesDto } from './dto/list-services.dto';
import {
  ServiceSummaryResponse,
  ServiceWithVersionsResponse,
} from './dto/service-response.dto';
import { ServicesService } from './services.service';

/**
 * Routes are mounted under the global prefix, so paths are /api/v1/services.
 *
 * The organization is taken from the authenticated token via @CurrentUser and
 * never from a query parameter or request body, so a caller cannot ask for
 * another tenant's data.
 */
@Controller('services')
@UseGuards(JwtAuthGuard)
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  /**
   * GET /api/v1/services
   *
   * Supports search, sort and pagination. Search is handled here rather than on
   * a separate /services/search route: a prefix match covers both partial and
   * exact lookups, and folding it into the list endpoint keeps pagination and
   * sorting working while a filter is applied.
   */
  @Get()
  findAll(
    @CurrentUser('organizationId') organizationId: string,
    @Query() query: ListServicesDto,
  ): Promise<PaginatedResponse<ServiceSummaryResponse>> {
    return this.servicesService.findAll(organizationId, query);
  }

  /**
   * GET /api/v1/services/:serviceId
   * GET /api/v1/services/:serviceId?include=versions
   *
   * ParseUUIDPipe turns a malformed id into a 400 rather than letting Postgres
   * reject the cast and surface as a 500.
   */
  @Get(':serviceId')
  findOne(
    @CurrentUser('organizationId') organizationId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Query() query: GetServiceQueryDto,
  ): Promise<ServiceSummaryResponse | ServiceWithVersionsResponse> {
    return this.servicesService.findOne(
      organizationId,
      serviceId,
      query.include === 'versions',
    );
  }

  /**
   * POST /api/v1/services
   *
   * Outside the read-only core scope, included per the brief's optional CRUD
   * consideration and because the mockup has an "Add New Service" button.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: CreateServiceDto,
  ): Promise<ServiceWithVersionsResponse> {
    return this.servicesService.create(organizationId, dto);
  }
}
