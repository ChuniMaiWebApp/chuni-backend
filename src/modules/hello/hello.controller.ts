import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HelloResponseDto } from './dto/hello-response.dto';
import { HelloService } from './hello.service';

@ApiTags('hello')
@Controller()
export class HelloController {
  constructor(private readonly helloService: HelloService) {}

  @Get()
  @ApiOperation({ summary: 'Sanity check endpoint' })
  @ApiOkResponse({ type: HelloResponseDto })
  getHello(): HelloResponseDto {
    return this.helloService.getHello();
  }
}
